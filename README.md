# 🍝 Deadlock Dinner

**An interactive, kid-friendly visualization of the Dining Philosophers problem** — watch *locks*, *mutexes*, *semaphores* and *deadlock* come alive at a candle-lit table, then read the real **Java** and **Go** code that makes it happen.

> Five hungry philosophers. Five forks. Each one needs **two** forks to eat spaghetti. What could possibly go wrong? 😅

🔗 **Live demo:** https://deadlock-dinner.pages.dev

![Deadlock Dinner — the table](docs/hero.png)

---

## What is this?

The [Dining Philosophers problem](https://en.wikipedia.org/wiki/Dining_philosophers_problem) is the classic way computer scientists teach **concurrency**: how multiple things sharing limited resources can step on each other's toes — and freeze forever in a **deadlock**.

This site makes it tangible. A 5-year-old can click a philosopher to make them hungry, watch forks glow as they're grabbed, and *see* the exact moment everybody gets stuck. Then they (or a curious grown-up) can flip to the **Code** tab and read working implementations.

## Features

- 🎬 **Live simulation** — philosophers think, get hungry, grab forks, and eat in real time. Forks physically slide into hands and glow with the holder's color.
- 👆 **Click to interact** — click any philosopher to make them hungry on demand. Turn on **Manual mode** to stage a deadlock by hand.
- 💥 **Force a deadlock** — one button recreates the textbook circular wait. A red **DEADLOCK** banner and animated arrows show exactly who's waiting on whom.
- 🩹 **Break the jam** — resolve a deadlock and watch the table flow again.
- 🧩 **Four strategies**, switchable live:
  | Rule | What it does | Safe? |
  |---|---|---|
  | **Naïve** | Grab left fork, then right | ❌ can deadlock |
  | **Fork Order** | Always grab the lower-numbered fork first (resource hierarchy) | ✅ |
  | **The Waiter** | A central mutex grants both forks atomically (arbitrator) | ✅ |
  | **Limited Seats** | At most N−1 may try at once (counting semaphore) | ✅ |
- 🎛️ **Tweakable variables** — number of philosophers (3–7), think time, eat time, and speed.
- ⌨️ **Real code** — syntax-highlighted **Java** and **Go** for every strategy, with a copy button.
- 💡 **Learn tab** — plain-language explanations of locks, mutexes, semaphores and the four conditions of deadlock.
- 📱 Fully responsive, keyboard shortcuts (`space` play/pause, `s` step, `r` reset), and `prefers-reduced-motion` support.

![Deadlock detected](docs/deadlock.png)

## Tech

Pure, dependency-free **static site** — vanilla HTML, CSS, and ES modules. No build step, no framework.

```
index.html          markup + the three tabs
css/styles.css      the "Midnight Maître D'" theme
js/sim.js           the concurrency engine (strategies + deadlock detection)
js/render.js        hybrid SVG + HTML renderer
js/app.js           controls, narrator, log, stats, code viewer
js/code-samples.js  the Java & Go reference programs
```

Syntax highlighting uses [highlight.js](https://highlightjs.org/) from a CDN (with a graceful plain-text fallback). Fonts: [Fraunces](https://fonts.google.com/specimen/Fraunces), [Hanken Grotesk](https://fonts.google.com/specimen/Hanken+Grotesk), [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono).

## Run locally

It's static, so any web server works (you do need a server, not `file://`, because it uses ES modules):

```bash
python3 -m http.server 8799
# open http://localhost:8799
```

## Deploy

Deployed to **Cloudflare Pages**:

```bash
wrangler pages deploy . --project-name deadlock-dinner
```

## The reference code

Both languages compile cleanly (`javac`, `go build`/`go vet`) and the `naive` versions genuinely *can* deadlock — that's the point. See the **Code** tab in the app or [`js/code-samples.js`](js/code-samples.js).

## License

[MIT](LICENSE) — have fun with it.

---

<sub>Made with 🍝 to explain locks, mutexes & deadlock.</sub>
