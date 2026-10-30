# Dragon Heist Jeopardy

A live Jeopardy board for our Waterdeep: Dragon Heist campaign.

- **Players** open the site on their phones (`/`), enter a name, and buzz in.
- **Host** opens `/host`, logs in with the host password, and runs the board: open clues, open buzzers, mark answers right or wrong, reveal answers, and run Final Jeopardy.
- A **Daily Double** is placed on a random tile (never the 100 row) each new game. Only the host can see where it is, and the "Move the Daily Double" button rerolls it.

- **Stream overlay** (`/overlay`) is a transparent layer with a contestant podium for each player. Podiums light up when someone buzzes in, flash green or red when you judge them, and count scores up and down.

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

## Stream overlay (OBS)

1. In OBS, add a **Browser** source.
2. Set the URL to your Railway link plus `/overlay?host=Zoe`, and the size to 1920 × 1080.
3. Put it above your webcam layer. The background is transparent, so only the podiums show.

URL options (combine them with `&`):

- `host=Zoe` adds a host lectern with your name on the left. Leave it off for contestants only.
- `scale=0.85` shrinks the podiums (or `1.1` to grow them).
- `offline=hide` hides players who've disconnected instead of dimming them.

Podiums stay in join order so nobody shuffles around mid-game. During Final Jeopardy, everyone's podium shows a "Wager locked" or "Answer locked" tag, and score changes stay hidden until you press **Reveal to players**.
