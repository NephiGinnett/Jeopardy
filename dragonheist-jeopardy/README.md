# Dragon Heist Jeopardy

A live Jeopardy board for our Waterdeep: Dragon Heist campaign.

- **Players** open the site on their phones (`/`), enter a name, and buzz in.
- **Host** opens `/host`, logs in with the host password, and runs the board: open clues, open buzzers, mark answers right or wrong, reveal answers, and run Final Jeopardy.
- A **Daily Double** is placed on a random tile (never the 100 row) each new game. Only the host can see where it is, and the "Move the Daily Double" button rerolls it.

## Run it locally

```
npm install
ADMIN_PASSWORD=yourpassword npm start
```

Then open http://localhost:3000 (players) and http://localhost:3000/host (host).

## Deploy on Railway

1. Push this folder to a GitHub repo.
2. In Railway, create a new project from that repo. It detects Node and runs `npm start`.
3. Add a variable: `ADMIN_PASSWORD` = whatever you want the host password to be.
4. Generate a public domain for the service, and send that link to your players. You use the same link with `/host` on the end.

The game saves to `data/state.json`, so a crash or restart mid-game keeps scores. A redeploy wipes that file unless you attach a Railway volume; if you do, set `DATA_DIR` to the volume's mount path.

## Edit the questions

Everything lives in `questions.json`: category names, clues, answers, point values, and Final Jeopardy. Keep the same number of clues in each category. After editing, restart the server and press **New game** on the host screen.

## How a round works

1. Click a tile on the host board. The clue appears on everyone's phone.
2. Read it aloud, then click **Open buzzers**. Buzzes line up in order.
3. Mark the first player **Correct** (+points, answer revealed) or **Wrong** (−points, they're locked out and the next person is up).
4. Click **Back to board** to clear the tile, or **Cancel and keep tile** if you opened it by mistake. Clicking a used tile puts it back.

Daily Double: choose who picked the tile; they wager on their phone (or you enter it for them), then click **Show clue** and mark them right or wrong.

Final Jeopardy: players wager on the category, answer privately on their phones, and you judge each answer before revealing everything.
