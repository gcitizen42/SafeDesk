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
SAFE = "0x9F6e831c8F8939DC0C830C6e492e7cEf4f9C2F5f"
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


def cast(*args, input_text=None):
    command = ["cast", *map(str, args)]
    return subprocess.check_output(command, text=True, input=input_text).strip()


def cast_call(rpc_url, address, signature, *args):
    return cast("call", address, signature, *args, "--rpc-url", rpc_url)


def require_cast():
    if not shutil.which("cast"):
        raise RuntimeError("Foundry cast is required and was not found on PATH.")


def checksum(address):
    return cast("to-check-sum-address", address)


def parse_addresses(text):
    return re.findall(r"0x[a-fA-F0-9]{40}", text)


def read_tx_builder(path):
    builder = json.loads(Path(path).read_text())
    txs = builder.get("transactions") or []
    if len(txs) != 1:
        raise RuntimeError(f"Expected exactly one transaction in Safe Builder JSON, found {len(txs)}.")
    tx = txs[0]
    values = tx.get("contractInputsValues") or {}
    required = ["prevOwner", "oldOwner", "newOwner"]
    missing = [key for key in required if not values.get(key)]
    if missing:
        raise RuntimeError(f"Missing Safe swapOwner fields: {', '.join(missing)}")
    return {
        "chain_id": str(builder.get("chainId")),
        "safe": checksum(builder.get("meta", {}).get("createdFromSafeAddress") or tx.get("to")),
        "to": checksum(tx["to"]),
        "prev_owner": checksum(values["prevOwner"]),
        "old_owner": checksum(values["oldOwner"]),
        "new_owner": checksum(values["newOwner"]),
    }


def create_environment(env, display_name, slug, safe):
    url = (
        "https://api.tenderly.co/api/public/v1/account/"
        f"{env['TENDERLY_ACCOUNT_SLUG']}/project/{env['TENDERLY_PROJECT_SLUG']}/environments"
    )
    payload = {
        "display_name": display_name,
        "slug": slug,
        "network_configs": [
            {
                "network_id": "1",
                "block_number": "latest",
                "chain_config_overrides": {"chain_id": str(DEFAULT_VIRTUAL_CHAIN_ID)},
                "explorer_config": {"enabled": True, "contract_verification_visibility": "src"},
                "accounts": [{"address": safe, "balance": quantity(ETH_100_WEI)}],
            }
        ],
    }
    response = http_json(
        url,
        payload,
        {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Access-Key": env["TENDERLY_ACCESS_KEY"],
        },
    )
    return response


def extract_vnet_details(environment):
    instance = environment.get("active_instance") or {}
    vnets = instance.get("vnets") or []
    if not vnets:
        raise RuntimeError("Tenderly environment response did not include active_instance.vnets.")
    vnet = vnets[0]
    rpcs = vnet.get("rpcs") or []
    admin_rpc = next((item.get("url") for item in rpcs if item.get("name") == "Admin RPC"), None)
    public_rpc = next((item.get("url") for item in rpcs if item.get("name") == "Public RPC"), None)
    if not admin_rpc:
        raise RuntimeError("Tenderly response did not include Admin RPC.")
    return {
        "environment_id": environment["id"],
        "instance_id": instance["id"],
        "vnet_id": vnet["id"],
        "admin_rpc": admin_rpc,
        "public_rpc": public_rpc,
        "fork_block": vnet.get("fork_config", {}).get("block_number"),
    }


def send_environment_tx(env, details, call_args):
    url = (
        "https://api.tenderly.co/api/public/v1/account/"
        f"{env['TENDERLY_ACCOUNT_SLUG']}/project/{env['TENDERLY_PROJECT_SLUG']}"
        f"/environments/{details['environment_id']}/instance/{details['instance_id']}"
        f"/vnet/{details['vnet_id']}/transactions"
    )
    return http_json(
        url,
        {"callArgs": call_args},
        {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Access-Key": env["TENDERLY_ACCESS_KEY"],
        },
    )


def safe_state(rpc_url, safe, old_owner, new_owner):
    owners = [checksum(address) for address in parse_addresses(cast_call(rpc_url, safe, "getOwners()(address[])"))]
    threshold = int(cast_call(rpc_url, safe, "getThreshold()(uint256)").split()[0])
    old_is_owner = cast_call(rpc_url, safe, "isOwner(address)(bool)", old_owner).lower() == "true"
    new_is_owner = cast_call(rpc_url, safe, "isOwner(address)(bool)", new_owner).lower() == "true"
    return {
        "owners": owners,
        "threshold": threshold,
        "old_owner_is_owner": old_is_owner,
        "new_owner_is_owner": new_is_owner,
    }


def scrub_vnet_response(environment):
    def scrub(value):
        if isinstance(value, dict):
            out = {}
            for key, item in value.items():
                if key == "url" or "rpc" in key.lower():
                    out[key] = "<redacted>"
                else:
                    out[key] = scrub(item)
            return out
        if isinstance(value, list):
            return [scrub(item) for item in value]
        return value

    return scrub(environment)


def main():
    parser = argparse.ArgumentParser(description="Simulate a Safe owner rotation on a public Tenderly vNet.")
    parser.add_argument("--tx-builder-json", required=True)
    parser.add_argument("--operation-dir", required=True)
    parser.add_argument("--env-file", default=str(DEFAULT_ENV_FILE))
    parser.add_argument("--display-name", default=None)
    parser.add_argument("--slug", default=None)
    args = parser.parse_args()

    require_cast()
    env = read_env(args.env_file)
    missing = [key for key in ["TENDERLY_ACCOUNT_SLUG", "TENDERLY_PROJECT_SLUG", "TENDERLY_ACCESS_KEY"] if not env.get(key)]
    if missing:
        raise RuntimeError(f"Missing Tenderly environment keys: {', '.join(missing)}")

    tx = read_tx_builder(args.tx_builder_json)
    if tx["chain_id"] != "1":
        raise RuntimeError(f"This script expects Ethereum mainnet chainId 1; got {tx['chain_id']}.")
    if tx["safe"] != SAFE or tx["to"] != SAFE:
        raise RuntimeError(f"Unexpected Safe target: safe={tx['safe']} to={tx['to']}")

    run_id = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    operation_dir = Path(args.operation_dir)
    run_dir = operation_dir / "simulations" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    slug = args.slug or f"tdao-signerrotation-9f6e-{run_id.replace('_', '-')}"
    display_name = args.display_name or f"tDAO Signer Rotation 9F6e {run_id}"

    environment = create_environment(env, display_name, slug, tx["safe"])
    details = extract_vnet_details(environment)
    (run_dir / "vnet.redacted.json").write_text(json.dumps(scrub_vnet_response(environment), indent=2) + "\n")
    (run_dir / "vnet.json").write_text(json.dumps(environment, indent=2) + "\n")
    (run_dir / "admin-rpc.txt").write_text(details["admin_rpc"] + "\n")

    before = safe_state(details["admin_rpc"], tx["safe"], tx["old_owner"], tx["new_owner"])
    data = cast("calldata", "swapOwner(address,address,address)", tx["prev_owner"], tx["old_owner"], tx["new_owner"])
    call_args = {
        "from": tx["safe"],
        "to": tx["safe"],
        "gas": quantity(8_000_000),
        "gasPrice": "0x0",
        "value": "0x0",
        "data": data,
    }
    transaction = send_environment_tx(env, details, call_args)
    after = safe_state(details["admin_rpc"], tx["safe"], tx["old_owner"], tx["new_owner"])

    passed = (
        transaction.get("status") == "success"
        and not transaction.get("reverted")
        and before["threshold"] == 6
        and after["threshold"] == 6
        and before["old_owner_is_owner"] is True
        and before["new_owner_is_owner"] is False
        and after["old_owner_is_owner"] is False
        and after["new_owner_is_owner"] is True
        and len(before["owners"]) == len(after["owners"]) == 9
    )

    result = {
        "run_id": run_id,
        "created_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "safe": tx["safe"],
        "method": "swapOwner(address,address,address)",
        "prev_owner": tx["prev_owner"],
        "old_owner": tx["old_owner"],
        "new_owner": tx["new_owner"],
        "environment_id": details["environment_id"],
        "instance_id": details["instance_id"],
        "vnet_id": details["vnet_id"],
        "dashboard_url": (
            f"https://dashboard.tenderly.co/{env['TENDERLY_ACCOUNT_SLUG']}/"
            f"{env['TENDERLY_PROJECT_SLUG']}/virtual-environments/{details['environment_id']}"
        ),
        "vnet_explorer_url": f"https://dashboard.tenderly.co/explorer/vnet/{details['vnet_id']}",
        "fork_block": details["fork_block"],
        "transaction": {
            "id": transaction.get("id"),
            "status": transaction.get("status"),
            "reverted": transaction.get("reverted"),
            "error_reason": transaction.get("error_reason"),
            "tx_hash": transaction.get("tx_hash"),
            "block_number": transaction.get("block_number"),
            "function_name": transaction.get("function_name"),
            "dashboard_url": transaction.get("dashboard_url"),
            "public_explorer_url": transaction.get("public_explorer_url"),
        },
        "before": before,
        "after": after,
        "passed": passed,
        "notes": [
            "The vNet transaction sends swapOwner from the Safe address to the Safe address to simulate the Safe's internal execution path.",
            "This did not sign, propose, or execute anything on Ethereum mainnet.",
            "Admin RPC is stored locally in admin-rpc.txt and vnet.json; do not share those files.",
        ],
    }
    (run_dir / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    print(f"result: {run_dir / 'result.json'}")


if __name__ == "__main__":
    main()
