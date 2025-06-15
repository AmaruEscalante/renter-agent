import subprocess
import json
import os

notion_token = os.getenv("NOTION_TOKEN")

headers = {
    "Authorization": f"Bearer {notion_token}",
    "Notion-Version": "2022-06-28",
}

cmd = [
    "docker",
    "run",
    "--rm",
    "-i",
    "-e",
    f"OPENAPI_MCP_HEADERS={json.dumps(headers)}",
    "mcp/notion",
]

proc = subprocess.Popen(
    cmd,
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    text=True,
)

# Send a request
proc.stdin.write(
    json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}) + "\n"
)
proc.stdin.flush()

# Read the response
response = proc.stdout.readline()
print(response)
