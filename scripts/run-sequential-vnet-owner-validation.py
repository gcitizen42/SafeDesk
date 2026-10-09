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


SAFE = "0x9F6e831c8F8939DC0C830C6e492e7cEf4f9C2F5f"
SENTINEL_OWNER = "0x0000000000000000000000000000000000000001"
ETH_100_WEI = 100 * 10**18

ADDRESSES = {
    "eastban": "0x2844a0d6442034D3027A05635F4224d966C54fD7",
    "johnpackel": "0x49848f38D31e2b150190E44a4fE056a239EA1aad",
    "mrsnubooty": "0x739730cCb2a34cc83D3e30645002C52bA4B06167",
    "fredy": "0x3c7832b15407D1BD8aE03C41D2A849006A0cD905",
    "wuji": "0xA6d76e990fE10C4b741ceb87590bE6cb23979a6e",
    "cvh": "0x76C6CEf8ae443fA7404dD60dabc18B9158e37A75",
    "mcitizen42": "0x9C20993E98aa5A6BAD8AD0FC42C2f4cc3008096f",
    "vict0r": "0xeceC507477b969FC05053fB044619b723D458E8e",
    "wailoaloa": "0xe05808c1EFe0302b27Fc21F0E4a0f15e21e62e78",
    "maclane": "0x09BA3869189E78814659a611e7eFe36BED25cE94",
    "piotr": "0x1778f7EC9eE1d6Cc72FA4e94189CfeF0DAd48b4A",
    "mich": "0xFe45baf0F18c207152A807c1b05926583CFE2e4b",
    "kelly": "0xA6d76e990fE10C4b741ceb87590bE6cb23979a6e",
}


def http_json(url, payload=None, headers=None, method=None, timeout=120):
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


def send_tx(rpc_url, sender, to, data, gas=1_500_000, value=0):
    tx_hash = rpc(
        rpc_url,
        "eth_sendTransaction",
        [{"from": sender, "to": to, "data": data, "gas": quantity(gas), "gasPrice": "0x0", "value": quantity(value)}],
    )
    for _ in range(60):
        receipt = rpc(rpc_url, "eth_getTransactionReceipt", [tx_hash])
        if receipt:
            if receipt.get("status") != "0x1":
                raise RuntimeError(f"Transaction reverted: {tx_hash}")
            return {"hash": tx_hash, "receipt": receipt}
        time.sleep(1)
    raise RuntimeError(f"Timed out waiting for receipt {tx_hash}")


def owners(rpc_url):
    return [checksum(address) for address in parse_addresses(cast_call(rpc_url, SAFE, "getOwners()(address[])"))]


def threshold(rpc_url):
    return int(cast_call(rpc_url, SAFE, "getThreshold()(uint256)").split()[0])


def nonce(rpc_url):
    return int(cast_call(rpc_url, SAFE, "nonce()(uint256)").split()[0])


def is_owner(rpc_url, address):
    return cast_call(rpc_url, SAFE, "isOwner(address)(bool)", address).lower() == "true"


def owner_prev(owner_list, old_owner):
    old = checksum(old_owner)
    if old not in owner_list:
        raise RuntimeError(f"Old owner is not currently an owner: {old}")
    index = owner_list.index(old)
    return SENTINEL_OWNER if index == 0 else owner_list[index - 1]


def approved_hash_signature(owner):
    owner_hex = checksum(owner).lower().replace("0x", "")
    return ("0" * 24) + owner_hex + ("0" * 64) + "01"


def signatures_for(approvers):
    ordered = sorted((checksum(address) for address in approvers), key=lambda item: int(item, 16))
    return "0x" + "".join(approved_hash_signature(address) for address in ordered)


def safe_state(rpc_url):
    state_owners = owners(rpc_url)
    return {
        "owners": state_owners,
        "threshold": threshold(rpc_url),
        "nonce": nonce(rpc_url),
        "is_owner": {name: is_owner(rpc_url, address) for name, address in ADDRESSES.items()},
    }


def execute_swap(rpc_url, label, old_label, new_label, executor_label, approver_labels):
    old_owner = checksum(ADDRESSES[old_label])
    new_owner = checksum(ADDRESSES[new_label])
    if not is_owner(rpc_url, old_owner) and is_owner(rpc_url, new_owner):
        return {
            "label": label,
            "old_label": old_label,
            "old_owner": old_owner,
            "new_label": new_label,
            "new_owner": new_owner,
            "executor_label": executor_label,
            "executor": checksum(ADDRESSES[executor_label]),
            "skipped": True,
            "reason": "Rotation already completed on this vNet.",
            "owner_removed": True,
            "owner_added": True,
            "threshold_after": threshold(rpc_url),
            "nonce_after": nonce(rpc_url),
            "owners_after": owners(rpc_url),
        }

    current_owners = owners(rpc_url)
    prev_owner = owner_prev(current_owners, ADDRESSES[old_label])
    executor = checksum(ADDRESSES[executor_label])
    approvers = [checksum(ADDRESSES[label]) for label in approver_labels]

    data = cast("calldata", "swapOwner(address,address,address)", prev_owner, old_owner, new_owner)
    tx_nonce = nonce(rpc_url)
    tx_hash = cast_call(
        rpc_url,
        SAFE,
        "getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256)(bytes32)",
        SAFE,
        0,
        data,
        0,
        0,
        0,
        0,
        "0x0000000000000000000000000000000000000000",
        "0x0000000000000000000000000000000000000000",
        tx_nonce,
    )

    approvals = []
    approve_data = cast("calldata", "approveHash(bytes32)", tx_hash)
    for approver in sorted(set(approvers), key=lambda item: int(item, 16)):
        approvals.append({"approver": approver, **send_tx(rpc_url, approver, SAFE, approve_data, gas=300_000)})

    signatures = signatures_for(approvers)
    exec_data = cast(
        "calldata",
        "execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)",
        SAFE,
        0,
        data,
        0,
        0,
        0,
        0,
        "0x0000000000000000000000000000000000000000",
        "0x0000000000000000000000000000000000000000",
        signatures,
    )
    execution = send_tx(rpc_url, executor, SAFE, exec_data, gas=2_000_000)
    after = safe_state(rpc_url)
    return {
        "label": label,
        "old_label": old_label,
        "old_owner": old_owner,
        "new_label": new_label,
        "new_owner": new_owner,
        "prev_owner": checksum(prev_owner),
        "executor_label": executor_label,
        "executor": executor,
        "approver_labels": approver_labels,
        "approvers": sorted((checksum(address) for address in approvers), key=lambda item: int(item, 16)),
        "safe_tx_nonce": tx_nonce,
        "safe_tx_hash": tx_hash,
        "approvals": [{"approver": item["approver"], "hash": item["hash"]} for item in approvals],
        "execution_hash": execution["hash"],
        "owner_removed": not is_owner(rpc_url, old_owner),
        "owner_added": is_owner(rpc_url, new_owner),
        "threshold_after": after["threshold"],
        "nonce_after": after["nonce"],
        "owners_after": after["owners"],
    }


def main():
    parser = argparse.ArgumentParser(description="Run sequential Safe owner swaps on an existing Tenderly vNet.")
    parser.add_argument("--admin-rpc-file", required=True)
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args()

    rpc_url = Path(args.admin_rpc_file).read_text().strip()
    run_dir = Path(args.out_dir)
    run_dir.mkdir(parents=True, exist_ok=True)

    initial = safe_state(rpc_url)
    actors = sorted(
        {
            ADDRESSES["maclane"],
            ADDRESSES["piotr"],
            ADDRESSES["mich"],
            ADDRESSES["johnpackel"],
            ADDRESSES["fredy"],
            ADDRESSES["wuji"],
            ADDRESSES["cvh"],
            ADDRESSES["mcitizen42"],
        },
        key=lambda item: int(checksum(item), 16),
    )
    rpc(rpc_url, "tenderly_setBalance", [[checksum(actor) for actor in actors], quantity(ETH_100_WEI)])
    steps = []

    steps.append(
        execute_swap(
            rpc_url,
            "Piotr in for Wailoaloa; Maclane executes",
            "wailoaloa",
            "piotr",
            "maclane",
            ["maclane", "johnpackel", "fredy", "wuji", "cvh", "mcitizen42"],
        )
    )
    steps.append(
        execute_swap(
            rpc_url,
            "Mich in for Eastban; Piotr executes",
            "eastban",
            "mich",
            "piotr",
            ["piotr", "johnpackel", "fredy", "wuji", "cvh", "mcitizen42"],
        )
    )

    kelly_noop = {
        "label": "Kelly for Wuji; Mich executes",
        "skipped": True,
        "reason": "Kelly address is identical to current Wuji owner address, so there is no onchain owner rotation to execute.",
        "kelly": checksum(ADDRESSES["kelly"]),
        "wuji": checksum(ADDRESSES["wuji"]),
        "mich_is_owner": is_owner(rpc_url, ADDRESSES["mich"]),
        "kelly_or_wuji_is_owner": is_owner(rpc_url, ADDRESSES["kelly"]),
        "threshold": threshold(rpc_url),
        "nonce": nonce(rpc_url),
    }
    final = safe_state(rpc_url)
    result = {
        "created_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "safe": SAFE,
        "initial": initial,
        "steps": steps,
        "kelly_noop": kelly_noop,
        "final": final,
        "passed": (
            steps[0]["owner_removed"]
            and steps[0]["owner_added"]
            and steps[1]["owner_removed"]
            and steps[1]["owner_added"]
            and final["threshold"] == 6
            and final["is_owner"]["maclane"]
            and final["is_owner"]["piotr"]
            and final["is_owner"]["mich"]
            and final["is_owner"]["kelly"]
            and not final["is_owner"]["wailoaloa"]
            and not final["is_owner"]["eastban"]
        ),
    }
    (run_dir / "sequential-owner-validation.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    print(f"result: {run_dir / 'sequential-owner-validation.json'}")


if __name__ == "__main__":
    main()
