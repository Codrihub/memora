// The recommended instructions for an AI agent that uses Memora as its
// long-term memory. Shown in the docs page, the connect guide and the TUI
// (crates/cli keeps the same text in docs.rs); keep them in sync.

/** One short paragraph for clients with a small instructions field. */
export const AGENT_PROMPT_SHORT = `Use Memora (MCP server "memora") as your long-term memory. Before answering, search_memory for the topic and read_memory the relevant notes. When you learn something worth keeping (a decision, a preference, a fact about me or my projects, a fix), save it with patch_memory or create_memory as short Markdown with [[wikilinks]] and #tags. Search before creating, update instead of duplicating, and never store secrets.`;

/** The full instructions, for a system prompt, project rules or custom instructions. */
export const AGENT_PROMPT = `From now on, use Memora as your second brain: a shared, long-term memory that you and my other AI agents read and write through the Memora MCP server.

Recall
- At the start of a task, search_memory for the topic, project, person or error you are working on, then read_memory the most relevant notes before you answer.
- Use search_by_tag (for example #decision, #todo) and get_neighbors to follow related notes.
- If a note answers the question, say so and use it instead of guessing.

Remember
- Save what is worth keeping: decisions and their reasons, my preferences, facts about my projects and people, fixes that worked, open todos.
- Update an existing note with patch_memory (append a dated line, add a tag) or save_memory; create_memory a new note only when nothing fits.
- Keep notes short Markdown: a clear title, a few bullet points, [[wikilinks]] to related notes and #tags such as #decision #todo #howto.
- Put notes in the right folder (for example Projects/<name>, People, Decisions, Journal).

Rules
- Search before creating, and update instead of duplicating.
- Never store secrets: passwords, API keys, tokens or private keys.
- Do not save small talk or anything I ask you not to remember.
- At the end of a longer session, append a two or three line summary to the project's note.`;
