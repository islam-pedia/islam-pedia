import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { registerSystemTools } from "./tools/system.ts"

const server = new McpServer({
  name: "islam-pedia",
  version: "0.1.0",
})

registerSystemTools(server)

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error: unknown) => {
  console.error("Islam Pedia MCP server failed:", error)
  process.exitCode = 1
})
