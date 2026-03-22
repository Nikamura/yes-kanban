we are working on self hosted kanban type board for managing ai agents.
then we have workers that work on the tickets, create branches, opens pull requests, merges pull requests.
spawns claude codes monitors what it's doing exposes questions for user in the board. 
supports plan/dangerously skip mode.
self hosted for solo enterpreneurs.
mobile first.
make commits often. small bits. while working don't wait for me to ask you to commit.
keep SPEC.md up to date with any specififcation changes.
use git log commits for storing information about why decisions.
Prefer TDD, RED - GREEN - REFACTOR approach. Write tests for new features before writing the code.
We use bun.
Every page, modal, and panel must have a unique URL. Users must be able to refresh the page and return to exactly where they were. Use hash-based routing: #/<slug>/<view>/<issueSimpleId>/ws/<workspaceId>.
We are opinionated convention-over-configuration. So we only want configuration only for limits/concurrency/timeouts/etc.
When making major changes (new features, new integrations, architectural changes), update README.md to reflect them.