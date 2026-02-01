# S.G.A 4 1/2 Graph

Interactive graph UI for exploring a prebuilt dependency graph of **S.G.A 4 1/2 (Cohomologie Étale)**.

## Run locally

```bash
npm ci
npm run dev
```

Open:

```
http://localhost:3000/graph/sga4-5
```

## References

- PDF: https://matematicas.unex.es/~navarro/res/sga/SGA%204%20%26%20HALF%20-%20Cohomologie%20Etale.pdf
- LaTeX source reference: https://github.com/NomiL/sga4.5

## About this graph

On first visit, an “About this graph” modal is shown (dismissal stored in `localStorage`).
You can reopen it via the small **ⓘ** icon next to the title.

## Correctness disclaimer

Edges represent “uses / depends on”. Some edges may be **inferred by an LLM**, and there is **no guarantee of correctness**.

## Debugging math rendering (optional)

Dev-only audit mode (renders all node previews off-screen and reports MathJax errors in the browser console):

```
http://localhost:3000/graph/sga4-5?audit=1
```
