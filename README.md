# CanvasOps

CanvasOps is an agent-native cloud architecture canvas. Humans can drag, connect,
and configure infrastructure visually while browser agents manipulate the exact
same React Flow state through WebMCP tools.

## WebMCP tools

- `analyze_current_architecture()` — graph, configuration, cost, resilience, and fingerprint
- `validate_architecture(constraints)` — deterministic budget, region, replica, and connectivity policy checks
- `propose_architecture_plan(operations)` — costed multi-step preview with human approval and atomic apply
- `add_infrastructure_node(type, x, y, config)` — deterministic node placement
- `move_node(node_id, x, y)` / `remove_node(node_id)` — complete spatial and lifecycle editing
- `connect_nodes(...)` / `disconnect_nodes(...)` — validated directional dependencies
- `update_node_config(...)` — label, region, size, replica, and environment updates with cost recalculation
- `auto_layout_architecture(direction, group_by)` — deterministic layer or region layout
- `simulate_region_outage(region, mode)` — visible failure and recovery simulation
- `undo_last_change()` / `redo_last_change()` — atomic reversal and replay of human or agent mutations
- `provision_and_pay(total_cost_usdc, architecture_hash)` — graph-bound, human-approved mocked x402 settlement

All inputs are strict Zod schemas. The first four tools use
`@mcp-b/react-webmcp`; the payment tool registers against
`document.modelContext.registerTool()` so compatible WebMCP runtimes can pass
`requestUserInteraction()` into its execution. The UI confirmation remains the
fallback in current draft runtimes.

The right-side **WebMCP Activity** console is not a chatbot. It records real
browser-agent tool calls with their exact arguments, result summaries, approval
status, and timestamp. Every graph mutation is snapshot-backed and undoable.
The graph is versioned in local storage, and the live resilience score updates
immediately as humans or agents change the canvas.

## Safety model

- Read-only analysis and validation tools are annotated with `readOnlyHint`.
- Multi-step plans show an exact before/after cost diff and require human approval.
- Plans that exceed their declared budget cannot be approved.
- Deployment recomputes the authoritative live cost and architecture fingerprint;
  stale or caller-invented quotes are rejected.
- Outage simulation changes only local visual state. Provisioning and settlement
  remain explicitly mocked for the hackathon MVP.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). For native WebMCP testing,
use ChatGPT's in-app browser or Chrome 149+ with
`chrome://flags/#enable-webmcp-testing` enabled.

## Demo prompts

- “Validate this architecture for Mumbai and Singapore, with at least 2 replicas and a $300 monthly budget.”
- “Propose a safe plan to make this architecture highly available under $300. Ask me to approve before applying it.”
- “Simulate a Mumbai outage, explain the affected paths, then recover the region. Do not deploy.”

## Scope

Cloud provisioning and stablecoin settlement are intentionally mocked. No real
wallet, cloud account, Terraform backend, authentication, or persistent server is
included in the hackathon MVP.

## License

MIT
