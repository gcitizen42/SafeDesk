#!/usr/bin/env python3
import argparse
import json
import re
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
SAFE = "0x9F6e831c8F8939DC0C830C6e492e7cEf4f9C2F5f"
ETH_100_WEI = 100 * 10**18
ZERO = "0x0000000000000000000000000000000000000000"


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


def cast(*args):
    return subprocess.check_output(["cast", *map(str, args)], text=True).strip()


def cast_call(rpc_url, address, signature, *args):
    return cast("call", address, signature, *args, "--rpc-url", rpc_url)


def checksum(address):
    return cast("to-check-sum-address", address)


def quantity(value):
    return hex(int(value))


def parse_addresses(text):
    return re.findall(r"0x[a-fA-F0-9]{40}", text)


def read_tx_builder(path):
    builder = json.loads(Path(path).read_text())
    txs = builder.get("transactions") or []
    if len(txs) != 1:
        raise RuntimeError(f"Expected exactly one transaction, got {len(txs)}.")
    values = txs[0].get("contractInputsValues") or {}
    return {
        "chain_id": str(builder.get("chainId")),
        "safe": checksum(builder.get("meta", {}).get("createdFromSafeAddress") or txs[0]["to"]),
        "to": checksum(txs[0]["to"]),
        "prev_owner": checksum(values["prevOwner"]),
        "old_owner": checksum(values["oldOwner"]),
        "new_owner": checksum(values["newOwner"]),
    }


def create_environment(env, display_name, slug, actors):
    url = (
        "https://api.tenderly.co/api/public/v1/account/"
        f"{env['TENDERLY_ACCOUNT_SLUG']}/project/{env['TENDERLY_PROJECT_SLUG']}/environments"
    )
    accounts = [{"address": checksum(address), "balance": quantity(ETH_100_WEI)} for address in actors]
    payload = {
        "display_name": display_name,
        "slug": slug,
        "network_configs": [
            {
                "network_id": "1",
                "block_number": "latest",
                "chain_config_overrides": {"chain_id": str(DEFAULT_VIRTUAL_CHAIN_ID)},
                "explorer_config": {"enabled": True, "contract_verification_visibility": "src"},
                "accounts": accounts,
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


def extract_details(environment):
    instance = environment.get("active_instance") or {}
    vnets = instance.get("vnets") or []
    if not vnets:
        raise RuntimeError("Tenderly response did not include active vNet.")
    vnet = vnets[0]
    admin_rpc = next((item["url"] for item in vnet.get("rpcs", []) if item.get("name") == "Admin RPC"), None)
    if not admin_rpc:
        raise RuntimeError("Tenderly response did not include Admin RPC.")
    return {
        "environment_id": environment["id"],
        "instance_id": instance["id"],
        "vnet_id": vnet["id"],
        "admin_rpc": admin_rpc,
        "fork_block": vnet.get("fork_config", {}).get("block_number"),
    }


def send_tx(rpc_url, sender, to, data, gas=2_000_000):
    tx_hash = rpc(
        rpc_url,
        "eth_sendTransaction",
        [{"from": sender, "to": to, "data": data, "gas": quantity(gas), "gasPrice": "0x0", "value": "0x0"}],
    )
    for _ in range(60):
        receipt = rpc(rpc_url, "eth_getTransactionReceipt", [tx_hash])
        if receipt:
            if receipt.get("status") != "0x1":
                raise RuntimeError(f"Transaction reverted: {tx_hash}")
            return {"hash": tx_hash, "receipt": receipt}
        time.sleep(1)
    raise RuntimeError(f"Timed out waiting for receipt {tx_hash}")


def approved_hash_signature(owner):
    owner_hex = checksum(owner).lower().replace("0x", "")
    return ("0" * 24) + owner_hex + ("0" * 64) + "01"


def signatures_for(owners):
    ordered = sorted((checksum(owner) for owner in owners), key=lambda item: int(item, 16))
    return "0x" + "".join(approved_hash_signature(owner) for owner in ordered)


def owners(rpc_url):
    return [checksum(address) for address in parse_addresses(cast_call(rpc_url, SAFE, "getOwners()(address[])"))]


def safe_state(rpc_url, old_owner, new_owner):
    return {
        "owners": owners(rpc_url),
        "threshold": int(cast_call(rpc_url, SAFE, "getThreshold()(uint256)").split()[0]),
        "nonce": int(cast_call(rpc_url, SAFE, "nonce()(uint256)").split()[0]),
        "old_owner_is_owner": cast_call(rpc_url, SAFE, "isOwner(address)(bool)", old_owner).lower() == "true",
        "new_owner_is_owner": cast_call(rpc_url, SAFE, "isOwner(address)(bool)", new_owner).lower() == "true",
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
    parser = argparse.ArgumentParser(description="Create a fresh Tenderly vNet and execute a Safe owner rotation via execTransaction.")
    parser.add_argument("--tx-builder-json", required=True)
    parser.add_argument("--operation-dir", required=True)
    parser.add_argument("--executor", required=True)
    parser.add_argument("--approvers", required=True, help="Comma-separated owner addresses. Include executor if they should count toward threshold.")
    parser.add_argument("--safe-tx-gas", type=int, default=500_000)
    parser.add_argument("--env-file", default=str(DEFAULT_ENV_FILE))
    parser.add_argument("--display-name", default=None)
    parser.add_argument("--slug", default=None)
    args = parser.parse_args()

    env = read_env(args.env_file)
    missing = [key for key in ["TENDERLY_ACCOUNT_SLUG", "TENDERLY_PROJECT_SLUG", "TENDERLY_ACCESS_KEY"] if not env.get(key)]
    if missing:
        raise RuntimeError(f"Missing Tenderly environment keys: {', '.join(missing)}")

    tx = read_tx_builder(args.tx_builder_json)
    executor = checksum(args.executor)
    approvers = [checksum(address) for address in args.approvers.split(",") if address.strip()]
    if executor not in approvers:
        approvers.append(executor)
    if len(set(address.lower() for address in approvers)) < 6:
        raise RuntimeError("Safe threshold is 6; provide at least 6 unique approvers.")

    run_id = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    operation_dir = Path(args.operation_dir)
    run_dir = operation_dir / "simulations" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    slug = args.slug or f"tdao-safe-exec-east-mich-{run_id.replace('_', '-')}"
    display_name = args.display_name or f"tDAO Safe exec Eastban to Mich {run_id}"
    environment = create_environment(env, display_name, slug, sorted({executor, *approvers}, key=lambda item: int(item, 16)))
    details = extract_details(environment)
    (run_dir / "vnet.redacted.json").write_text(json.dumps(scrub_vnet_response(environment), indent=2) + "\n")
    (run_dir / "vnet.json").write_text(json.dumps(environment, indent=2) + "\n")
    (run_dir / "admin-rpc.txt").write_text(details["admin_rpc"] + "\n")

    before = safe_state(details["admin_rpc"], tx["old_owner"], tx["new_owner"])
    data = cast("calldata", "swapOwner(address,address,address)", tx["prev_owner"], tx["old_owner"], tx["new_owner"])
    safe_nonce = before["nonce"]
    safe_tx_hash = cast_call(
        details["admin_rpc"],
        SAFE,
        "getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256)(bytes32)",
        SAFE,
        0,
        data,
        0,
        args.safe_tx_gas,
        0,
        0,
        ZERO,
        ZERO,
        safe_nonce,
    )

    approve_data = cast("calldata", "approveHash(bytes32)", safe_tx_hash)
    approvals = []
    for approver in sorted(set(approvers), key=lambda item: int(item, 16)):
        approvals.append({"approver": approver, **send_tx(details["admin_rpc"], approver, SAFE, approve_data, gas=300_000)})

    signatures = signatures_for(approvers)
    exec_data = cast(
        "calldata",
        "execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)",
        SAFE,
        0,
        data,
        0,
        args.safe_tx_gas,
        0,
        0,
        ZERO,
        ZERO,
        signatures,
    )
    execution = send_tx(details["admin_rpc"], executor, SAFE, exec_data, gas=2_500_000)
    after = safe_state(details["admin_rpc"], tx["old_owner"], tx["new_owner"])

    result = {
        "run_id": run_id,
        "created_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "safe": SAFE,
        "operation": "swapOwner via Safe execTransaction",
        "prev_owner": tx["prev_owner"],
        "old_owner": tx["old_owner"],
        "new_owner": tx["new_owner"],
        "executor": executor,
        "approvers": sorted(set(approvers), key=lambda item: int(item, 16)),
        "environment_id": details["environment_id"],
        "instance_id": details["instance_id"],
        "vnet_id": details["vnet_id"],
        "dashboard_url": f"https://dashboard.tenderly.co/{env['TENDERLY_ACCOUNT_SLUG']}/{env['TENDERLY_PROJECT_SLUG']}/virtual-environments/{details['environment_id']}",
        "vnet_explorer_url": f"https://dashboard.tenderly.co/explorer/vnet/{details['vnet_id']}",
        "fork_block": details["fork_block"],
        "safe_tx_nonce": safe_nonce,
        "safe_tx_gas": args.safe_tx_gas,
        "safe_tx_hash": safe_tx_hash,
        "approval_txs": [{"approver": item["approver"], "hash": item["hash"]} for item in approvals],
        "execution_tx": execution["hash"],
        "before": before,
        "after": after,
        "passed": (
            before["threshold"] == 6
            and after["threshold"] == 6
            and before["old_owner_is_owner"] is True
            and before["new_owner_is_owner"] is False
            and after["old_owner_is_owner"] is False
            and after["new_owner_is_owner"] is True
            and len(before["owners"]) == len(after["owners"]) == 9
        ),
        "notes": [
            "This simulates the real Safe path: owners approveHash, then executor calls execTransaction.",
            "No mainnet transaction was signed, proposed, or executed.",
            "Do not share vnet.json or admin-rpc.txt.",
        ],
    }
    (run_dir / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    print(f"result: {run_dir / 'result.json'}")


if __name__ == "__main__":
    main()
