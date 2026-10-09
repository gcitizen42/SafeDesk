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


def rpc_raw(rpc_url, method, params=None):
    payload = {
        "jsonrpc": "2.0",
        "id": int(time.time() * 1000),
        "method": method,
        "params": params or [],
    }
    return http_json(rpc_url, payload, {"Content-Type": "application/json"})


def rpc(rpc_url, method, params=None):
    data = rpc_raw(rpc_url, method, params)
    if "error" in data:
        raise RuntimeError(f"RPC {method} failed: {json.dumps(data['error'])}")
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


def decode_revert(error):
    if not error:
        return None

    def find_data(value):
        if isinstance(value, str) and value.startswith("0x08c379a0"):
            return value
        if isinstance(value, dict):
            for item in value.values():
                found = find_data(item)
                if found:
                    return found
        if isinstance(value, list):
            for item in value:
                found = find_data(item)
                if found:
                    return found
        return None

    data = find_data(error)
    if not data:
        return error.get("message") if isinstance(error, dict) else str(error)
    try:
        body = data[10:]
        strlen = int(body[64:128], 16)
        string_hex = body[128 : 128 + strlen * 2]
        return bytes.fromhex(string_hex).decode(errors="replace")
    except Exception:
        return error.get("message") if isinstance(error, dict) else str(error)


def create_environment(env, display_name, slug, chain_id, actors):
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
                "network_id": str(chain_id),
                "block_number": "latest",
                "chain_config_overrides": {"chain_id": str(chain_id)},
                "explorer_config": {
                    "enabled": True,
                    "contract_verification_visibility": "src",
                },
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


def send_tx(rpc_url, sender, to, data, gas):
    tx = {
        "from": checksum(sender),
        "to": checksum(to),
        "data": data,
        "gas": quantity(gas),
        "gasPrice": "0x0",
        "value": "0x0",
    }
    response = rpc_raw(rpc_url, "eth_sendTransaction", [tx])
    if "error" in response:
        return {
            "ok": False,
            "hash": None,
            "error": response["error"],
            "reason": decode_revert(response["error"]),
        }
    tx_hash = response["result"]
    for _ in range(60):
        receipt = rpc(rpc_url, "eth_getTransactionReceipt", [tx_hash])
        if receipt:
            ok = receipt.get("status") == "0x1"
            return {
                "ok": ok,
                "hash": tx_hash,
                "receipt": receipt,
                "error": None if ok else {"message": "Transaction reverted"},
                "reason": None if ok else "Transaction reverted",
            }
        time.sleep(1)
    return {"ok": False, "hash": tx_hash, "error": {"message": "Timed out"}, "reason": "Timed out"}


def eth_call(rpc_url, sender, to, data, gas):
    response = rpc_raw(
        rpc_url,
        "eth_call",
        [
            {
                "from": checksum(sender),
                "to": checksum(to),
                "data": data,
                "gas": quantity(gas),
                "gasPrice": "0x0",
                "value": "0x0",
            },
            "latest",
        ],
    )
    if "error" in response:
        return {"ok": False, "error": response["error"], "reason": decode_revert(response["error"])}
    return {"ok": True, "result": response["result"], "error": None, "reason": None}


def approved_hash_signature(owner):
    owner_hex = checksum(owner).lower().replace("0x", "")
    return ("0" * 24) + owner_hex + ("0" * 64) + "01"


def signatures_for(owners):
    ordered = sorted((checksum(owner) for owner in owners), key=lambda item: int(item, 16))
    return "0x" + "".join(approved_hash_signature(owner) for owner in ordered)


def safe_state(rpc_url, safe):
    return {
        "nonce": int(cast_call(rpc_url, safe, "nonce()(uint256)").split()[0]),
        "threshold": int(cast_call(rpc_url, safe, "getThreshold()(uint256)").split()[0]),
        "owners": [
            checksum(item)
            for item in cast_call(rpc_url, safe, "getOwners()(address[])").replace("[", "").replace("]", "").replace(",", " ").split()
        ],
    }


def expected_owners_after(before_owners, inner_transactions):
    owners = [checksum(item) for item in before_owners]
    for tx in inner_transactions:
        if tx.get("method") != "swapOwner":
            continue
        values = tx.get("inputs") or {}
        old_owner = checksum(values["oldOwner"])
        new_owner = checksum(values["newOwner"])
        owners = [new_owner if owner.lower() == old_owner.lower() else owner for owner in owners]
    return owners


def main():
    parser = argparse.ArgumentParser(description="Simulate a prepared Safe transaction on a fresh Tenderly vNet using assumed approvals.")
    parser.add_argument("--operation-dir", required=True)
    parser.add_argument("--env-file", default=str(DEFAULT_ENV_FILE))
    parser.add_argument("--display-name", default=None)
    parser.add_argument("--slug", default=None)
    parser.add_argument("--executor", default=None, help="Optional owner address to use as executor. Defaults to first Safe owner.")
    args = parser.parse_args()

    operation_dir = Path(args.operation_dir)
    params = json.loads((operation_dir / "safe-custom-data-params.json").read_text())
    inner_transactions = json.loads((operation_dir / "decoded-inner-transactions.json").read_text())
    current_owners = json.loads((operation_dir / "current-owners.json").read_text())["owners"]
    env = read_env(args.env_file)
    missing = [key for key in ["TENDERLY_ACCOUNT_SLUG", "TENDERLY_PROJECT_SLUG", "TENDERLY_ACCESS_KEY"] if not env.get(key)]
    if missing:
        raise RuntimeError(f"Missing Tenderly environment keys: {', '.join(missing)}")

    chain_id = int(params["chainId"])
    safe = checksum(params["safe"])
    to = checksum(params["to"])
    approvers = [checksum(item) for item in current_owners]
    executor = checksum(args.executor or approvers[0])
    if executor.lower() not in {item.lower() for item in approvers}:
        raise RuntimeError("Executor must be one of the current Safe owners.")

    run_id = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    run_dir = operation_dir / "simulations" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    environment = create_environment(
        env,
        args.display_name or f"tDAO Safe rotation exact exec chain {chain_id} {run_id}",
        args.slug or f"tdao-safe-rotation-chain-{chain_id}-{run_id.replace('_', '-')}",
        chain_id,
        sorted({safe, executor, *approvers}, key=lambda item: int(item, 16)),
    )
    details = extract_details(environment)
    (run_dir / "vnet.json").write_text(json.dumps(environment, indent=2) + "\n")
    (run_dir / "vnet.redacted.json").write_text(json.dumps(scrub_vnet_response(environment), indent=2) + "\n")
    (run_dir / "admin-rpc.txt").write_text(details["admin_rpc"] + "\n")

    before = safe_state(details["admin_rpc"], safe)
    expected_after = expected_owners_after(before["owners"], inner_transactions)

    safe_tx_hash = cast_call(
        details["admin_rpc"],
        safe,
        "getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256)(bytes32)",
        to,
        int(params["value"]),
        params["data"],
        int(params["operation"]),
        int(params["safeTxGas"]),
        int(params["baseGas"]),
        int(params["gasPrice"]),
        params["gasToken"],
        params["refundReceiver"],
        int(params["nonce"]),
    )

    approve_data = cast("calldata", "approveHash(bytes32)", safe_tx_hash)
    approvals = [
        {
            "approver": approver,
            **send_tx(details["admin_rpc"], approver, safe, approve_data, 300_000),
        }
        for approver in approvers
    ]

    signatures = signatures_for(approvers)
    exec_data = cast(
        "calldata",
        "execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)",
        to,
        int(params["value"]),
        params["data"],
        int(params["operation"]),
        int(params["safeTxGas"]),
        int(params["baseGas"]),
        int(params["gasPrice"]),
        params["gasToken"],
        params["refundReceiver"],
        signatures,
    )
    safe_exec_call = eth_call(details["admin_rpc"], executor, safe, exec_data, 12_000_000)
    execution = send_tx(details["admin_rpc"], executor, safe, exec_data, 12_000_000) if safe_exec_call["ok"] else None
    after = safe_state(details["admin_rpc"], safe)

    owner_set_matches = {item.lower() for item in after["owners"]} == {item.lower() for item in expected_after}
    passed = bool(
        safe_tx_hash.lower() == params["expectedSafeTxHash"].lower()
        and all(item["ok"] for item in approvals)
        and safe_exec_call["ok"]
        and execution
        and execution["ok"]
        and after["threshold"] == before["threshold"]
        and after["nonce"] == before["nonce"] + 1
        and owner_set_matches
    )

    result = {
        "run_id": run_id,
        "created_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "simulation_type": "fresh Tenderly vNet exact Safe execTransaction with assumed owner approvals",
        "safe": safe,
        "chain_id": str(params["chainId"]),
        "expected_safe_tx_hash": params["expectedSafeTxHash"],
        "computed_safe_tx_hash": safe_tx_hash,
        "hash_matches": safe_tx_hash.lower() == params["expectedSafeTxHash"].lower(),
        "safe_tx_operation": params["operation"],
        "safe_tx_target": to,
        "environment_id": details["environment_id"],
        "instance_id": details["instance_id"],
        "vnet_id": details["vnet_id"],
        "dashboard_url": f"https://dashboard.tenderly.co/{env['TENDERLY_ACCOUNT_SLUG']}/{env['TENDERLY_PROJECT_SLUG']}/virtual-environments/{details['environment_id']}",
        "vnet_explorer_url": f"https://dashboard.tenderly.co/explorer/vnet/{details['vnet_id']}",
        "fork_block": details["fork_block"],
        "executor": executor,
        "approvers": approvers,
        "before": before,
        "after": after,
        "expected_after_owners": expected_after,
        "owner_set_matches": owner_set_matches,
        "approval_txs": [{"approver": item["approver"], "ok": item["ok"], "hash": item["hash"], "reason": item["reason"]} for item in approvals],
        "safe_exec_call": safe_exec_call,
        "execution_tx": None if execution is None else {
            "ok": execution["ok"],
            "hash": execution["hash"],
            "reason": execution["reason"],
        },
        "passed": passed,
        "notes": [
            "This is a vNet simulation only; no mainnet transaction was sent.",
            "Approvals are simulated with approveHash from current Safe owners in the vNet.",
            "The exact Safe tx hash is checked before execution.",
            "Do not share vnet.json or admin-rpc.txt because they contain the admin RPC.",
        ],
    }
    (run_dir / "result.json").write_text(json.dumps(result, indent=2) + "\n")

    lines = [
        "# Treasury Safe Rotation vNet Simulation",
        "",
        f"- Run: `{run_id}`",
        f"- Safe: `{safe}`",
        f"- Fork block: `{details['fork_block']}`",
        f"- Expected Safe tx hash: `{params['expectedSafeTxHash']}`",
        f"- Computed Safe tx hash: `{safe_tx_hash}`",
        f"- Hash matches: `{result['hash_matches']}`",
        f"- Operation: `{params['operation']}`",
        f"- Target: `{to}`",
        f"- Passed: `{passed}`",
        f"- Tenderly environment: {result['dashboard_url']}",
        f"- Tenderly vNet explorer: {result['vnet_explorer_url']}",
        "",
        "## Safe Execution",
        "",
        f"- Simulated approvals: `{sum(1 for item in approvals if item['ok'])}/{len(approvals)}`",
        f"- Safe exec eth_call: {'PASS' if safe_exec_call['ok'] else 'FAIL: ' + str(safe_exec_call['reason'])}",
        f"- Safe exec transaction: {'not sent because eth_call failed' if execution is None else ('PASS `' + execution['hash'] + '`' if execution['ok'] else 'FAIL: ' + str(execution['reason']))}",
        f"- Final owner set matches expected: `{owner_set_matches}`",
        "",
        "## Before",
        "",
        f"- Threshold: `{before['threshold']}`",
        f"- Nonce: `{before['nonce']}`",
        "",
        "```json",
        json.dumps(before["owners"], indent=2),
        "```",
        "",
        "## After",
        "",
        f"- Threshold: `{after['threshold']}`",
        f"- Nonce: `{after['nonce']}`",
        "",
        "```json",
        json.dumps(after["owners"], indent=2),
        "```",
        "",
        "## Local Files",
        "",
        f"- `result.json`: `{run_dir / 'result.json'}`",
        f"- `vnet.redacted.json`: `{run_dir / 'vnet.redacted.json'}`",
        f"- `vnet.json`: `{run_dir / 'vnet.json'}`",
        f"- `admin-rpc.txt`: `{run_dir / 'admin-rpc.txt'}`",
    ]
    (run_dir / "REPORT.md").write_text("\n".join(lines) + "\n")

    print(json.dumps({k: result[k] for k in ["run_id", "safe", "hash_matches", "owner_set_matches", "passed", "dashboard_url", "vnet_explorer_url", "fork_block"]}, indent=2))
    print(f"report: {run_dir / 'REPORT.md'}")
    print(f"result: {run_dir / 'result.json'}")


if __name__ == "__main__":
    main()
