import { McpServer } from "@modelcontextprotocol/sdk/server/mcp"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio"
import { registerPeopleTools } from "@/mcp/tools/people"
import { registerSystemTools } from "@/mcp/tools/system"

const server = new McpServer({
  name: "islam-pedia",
  version: "0.1.0",
})

registerSystemTools(server)
registerPeopleTools(server)

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error: unknown) => {
  console.error("Islam Pedia MCP server failed:", error)
  process.exitCode = 1
})
