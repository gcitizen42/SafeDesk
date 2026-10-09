#!/usr/bin/env python3
import argparse
import json
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
AI_OPS_ROOT = PROJECT_ROOT.parent
DEFAULT_ENV_FILE = AI_OPS_ROOT / "Tenderly_simulations" / ".env"
DEFAULT_VIRTUAL_CHAIN_ID = 73571
ETH_100_WEI = 100 * 10**18


def read_env(path):
    values = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key] = value.strip().strip('"').strip("'")
    return values


def http_json(url, payload=None, headers=None, method=None, timeout=180):
    body = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise RuntimeError(f"HTTP {error.code} from {url}: {detail}") from error


def rpc(rpc_url, method, params=None):
    payload = {"jsonrpc": "2.0", "id": int(time.time() * 1000), "method": method, "params": params or []}
    data = http_json(rpc_url, payload, {"Content-Type": "application/json"})
    if "error" in data:
        raise RuntimeError(f"RPC {method} failed: {data['error']}")
    return data["result"]


def quantity(value):
    return hex(int(value))


def cast(*args):
    return subprocess.check_output(["cast", *map(str, args)], text=True).strip()


def cast_call(rpc_url, address, signature, *args):
    return cast("call", address, signature, *args, "--rpc-url", rpc_url)


def require_cast():
    if not shutil.which("cast"):
        raise RuntimeError("Foundry cast is required and was not found on PATH.")


def checksum(address):
    return cast("to-check-sum-address", address)


def parse_addresses(text):
    return re.findall(r"0x[a-fA-F0-9]{40}", text)


def read_builder(path):
    builder = json.loads(Path(path).read_text())
    txs = builder.get("transactions") or []
    if not txs:
        raise RuntimeError("Safe Builder JSON has no transactions.")
    safe = checksum(builder.get("meta", {}).get("createdFromSafeAddress") or txs[0]["to"])
    for tx in txs:
        if checksum(tx["to"]) != safe:
            raise RuntimeError(f"Unexpected transaction target {tx['to']}; expected Safe {safe}.")
    return builder, safe, str(builder.get("chainId"))


def tx_calldata(tx):
    method = (tx.get("contractMethod") or {}).get("name")
    values = tx.get("contractInputsValues") or {}
    if method == "swapOwner":
        return cast(
            "calldata",
            "swapOwner(address,address,address)",
            values["prevOwner"],
            values["oldOwner"],
            values["newOwner"],
        )
    if method == "removeOwner":
        return cast(
            "calldata",
            "removeOwner(address,address,uint256)",
            values["prevOwner"],
            values["owner"],
            values["_threshold"],
        )
    if method == "addOwnerWithThreshold":
        return cast(
            "calldata",
            "addOwnerWithThreshold(address,uint256)",
            values["owner"],
            values["_threshold"],
        )
    if method == "changeThreshold":
        return cast("calldata", "changeThreshold(uint256)", values["_threshold"])
    raise RuntimeError(f"Unsupported Safe owner method: {method}")


def create_environment(env, display_name, slug, chain_id, safe):
    url = (
        "https://api.tenderly.co/api/public/v1/account/"
        f"{env['TENDERLY_ACCOUNT_SLUG']}/project/{env['TENDERLY_PROJECT_SLUG']}/environments"
    )
    payload = {
        "display_name": display_name,
        "slug": slug,
        "network_configs": [
            {
                "network_id": str(chain_id),
                "block_number": "latest",
                "chain_config_overrides": {"chain_id": str(DEFAULT_VIRTUAL_CHAIN_ID)},
                "explorer_config": {"enabled": True, "contract_verification_visibility": "src"},
                "accounts": [{"address": safe, "balance": quantity(ETH_100_WEI)}],
            }
        ],
    }
    return http_json(
        url,
        payload,
        {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Access-Key": env["TENDERLY_ACCESS_KEY"],
        },
    )


def extract_vnet_details(environment):
    instance = environment.get("active_instance") or {}
    vnets = instance.get("vnets") or []
    if not vnets:
        raise RuntimeError("Tenderly environment response did not include active_instance.vnets.")
    vnet = vnets[0]
    admin_rpc = next((item.get("url") for item in vnet.get("rpcs", []) if item.get("name") == "Admin RPC"), None)
    if not admin_rpc:
        raise RuntimeError("Tenderly response did not include Admin RPC.")
    return {
        "environment_id": environment["id"],
        "instance_id": instance["id"],
        "vnet_id": vnet["id"],
        "admin_rpc": admin_rpc,
        "fork_block": vnet.get("fork_config", {}).get("block_number"),
    }


def send_tx(rpc_url, sender, to, data, gas=8_000_000):
    tx_hash = rpc(
        rpc_url,
        "eth_sendTransaction",
        [{"from": sender, "to": to, "data": data, "gas": quantity(gas), "gasPrice": "0x0", "value": "0x0"}],
    )
    for _ in range(90):
        receipt = rpc(rpc_url, "eth_getTransactionReceipt", [tx_hash])
        if receipt:
            return {"hash": tx_hash, "receipt": receipt}
        time.sleep(1)
    raise RuntimeError(f"Timed out waiting for receipt {tx_hash}")


def safe_state(rpc_url, safe):
    return {
        "owners": [checksum(address) for address in parse_addresses(cast_call(rpc_url, safe, "getOwners()(address[])"))],
        "threshold": int(cast_call(rpc_url, safe, "getThreshold()(uint256)").split()[0]),
        "nonce": int(cast_call(rpc_url, safe, "nonce()(uint256)").split()[0]),
    }


def scrub_vnet_response(environment):
    def scrub(value):
        if isinstance(value, dict):
            return {
                key: "<redacted>" if key == "url" or "rpc" in key.lower() else scrub(item)
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [scrub(item) for item in value]
        return value

    return scrub(environment)


def main():
    parser = argparse.ArgumentParser(description="Simulate a Safe Transaction Builder owner batch on a fresh Tenderly vNet.")
    parser.add_argument("--tx-builder-json", required=True)
    parser.add_argument("--operation-dir", required=True)
    parser.add_argument("--expected-owners", required=True, help="Comma-separated final owner addresses.")
    parser.add_argument("--expected-threshold", type=int, required=True)
    parser.add_argument("--env-file", default=str(DEFAULT_ENV_FILE))
    parser.add_argument("--display-name", default=None)
    parser.add_argument("--slug", default=None)
    args = parser.parse_args()

    require_cast()
    env = read_env(args.env_file)
    missing = [key for key in ["TENDERLY_ACCOUNT_SLUG", "TENDERLY_PROJECT_SLUG", "TENDERLY_ACCESS_KEY"] if not env.get(key)]
    if missing:
        raise RuntimeError(f"Missing Tenderly environment keys: {', '.join(missing)}")

    builder, safe, chain_id = read_builder(args.tx_builder_json)
    expected_owners = [checksum(address) for address in args.expected_owners.split(",") if address.strip()]

    run_id = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    operation_dir = Path(args.operation_dir)
    run_dir = operation_dir / "simulations" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    slug = args.slug or f"tdao-safe-builder-{safe[2:8].lower()}-{run_id.replace('_', '-')}"
    display_name = args.display_name or f"tDAO Safe Builder direct check {safe[:8]} {run_id}"

    environment = create_environment(env, display_name, slug, chain_id, safe)
    details = extract_vnet_details(environment)
    (run_dir / "vnet.redacted.json").write_text(json.dumps(scrub_vnet_response(environment), indent=2) + "\n")
    (run_dir / "vnet.json").write_text(json.dumps(environment, indent=2) + "\n")
    (run_dir / "admin-rpc.txt").write_text(details["admin_rpc"] + "\n")

    before = safe_state(details["admin_rpc"], safe)
    tx_results = []
    for index, tx in enumerate(builder["transactions"]):
        data = tx_calldata(tx)
        sent = send_tx(details["admin_rpc"], safe, safe, data)
        tx_results.append({
            "index": index,
            "method": (tx.get("contractMethod") or {}).get("name"),
            "inputs": tx.get("contractInputsValues") or {},
            "hash": sent["hash"],
            "status": sent["receipt"].get("status"),
            "block_number": sent["receipt"].get("blockNumber"),
        })
        if sent["receipt"].get("status") != "0x1":
            raise RuntimeError(f"Transaction {index} reverted: {sent['hash']}")

    after = safe_state(details["admin_rpc"], safe)
    passed = (
        after["threshold"] == args.expected_threshold
        and len(after["owners"]) == len(expected_owners)
        and {item.lower() for item in after["owners"]} == {item.lower() for item in expected_owners}
    )

    result = {
        "run_id": run_id,
        "created_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "simulation_type": "fresh Tenderly vNet direct Safe owner batch",
        "safe": safe,
        "chain_id": chain_id,
        "tx_builder_json": str(Path(args.tx_builder_json).resolve()),
        "transaction_count": len(builder["transactions"]),
        "environment_id": details["environment_id"],
        "instance_id": details["instance_id"],
        "vnet_id": details["vnet_id"],
        "vnet_explorer_url": f"https://dashboard.tenderly.co/explorer/vnet/{details['vnet_id']}",
        "fork_block": details["fork_block"],
        "before": before,
        "transactions": tx_results,
        "after": after,
        "expected_owners": expected_owners,
        "expected_threshold": args.expected_threshold,
        "passed": passed,
        "notes": [
            "This applies each Safe Builder owner-management transaction as the Safe sender on a fresh Tenderly vNet.",
            "It validates owner pointers and final owner/threshold state.",
            "It is not a mainnet signature, proposal, or execution.",
            "Do not share vnet.json or admin-rpc.txt.",
        ],
    }
    (run_dir / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    print(f"result: {run_dir / 'result.json'}")


if __name__ == "__main__":
    main()
