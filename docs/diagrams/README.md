# FYP Diagrams — AI Financial Advisor (IRIS)

University of Limerick — Final Year Project Diagram Pack

All diagrams use [Mermaid](https://mermaid.js.org/) syntax and render directly on GitHub.
To export as images: paste any code block into [mermaid.live](https://mermaid.live) and download SVG/PNG.
To use in reports: copy the Mermaid block into draw.io (Extras → Edit Diagram) or Lucidchart.

---

## Diagram Index

| # | File | Type | Purpose |
|---|------|------|---------|
| 1 | [01_context_diagram.md](./01_context_diagram.md) | Context Diagram (DFD Level 0) | System boundary, all external entities and data flows |
| 2 | [02_use_case_diagram.md](./02_use_case_diagram.md) | Use Case Diagram | All actors and system use cases |
| 3 | [03_component_diagram.md](./03_component_diagram.md) | Component / Architecture Diagram | Frontend, backend, and database components |
| 4 | [04_data_pipeline_diagram.md](./04_data_pipeline_diagram.md) | Data Pipeline Diagram | Full data flow with decision conditions and data sources |
| 5 | [05_database_schema.md](./05_database_schema.md) | Schema / Class Diagram | All 6 database schemas, tables, and relationships |
| 6 | [06_sequence_diagrams.md](./06_sequence_diagrams.md) | Sequence Diagrams | Key system workflows step-by-step |
| 7 | [07_deployment_diagram.md](./07_deployment_diagram.md) | Deployment Diagram | Infrastructure, hosting, and network topology |
| 8 | [08_state_diagrams.md](./08_state_diagrams.md) | State Machine Diagrams | User lifecycle and entity state transitions |
| 9 | [09_activity_diagrams.md](./09_activity_diagrams.md) | Activity Diagrams | Detailed business process flows |

---

## System Summary

**IRIS** (Intelligent Research and Investment System) is an AI-powered financial advisor built for student investors. It combines:

- Conversational AI that adapts to user knowledge level (Tier 1–3)
- Paper trading for risk-free practice
- Structured financial education (Academy)
- Goal tracking and financial planning (Meridian)
- Real-time market intelligence and stock ranking

**Tech Stack:** React/TypeScript (Vite) · FastAPI (Python) · Supabase (PostgreSQL) · OpenAI GPT-5 · Vercel/Railway
