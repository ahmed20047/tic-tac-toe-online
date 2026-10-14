# tic-tac-toe-online

online tic tac toe game. one player creates a room, sends the 4 letter code to a friend, and they play from different devices.

built with node.js + socket.io. all the game logic (turns, win check, blocking invalid moves) lives on the server so nobody can cheat from the browser.

## run it

```
npm install
npm start
```

then open http://localhost:3000

## how it works

- `server.js` - express + socket.io server. keeps the rooms in memory, validates every move, broadcasts the game state to each player (each player gets their own copy because they need to know their own symbol)
- `public/index.html` - the whole frontend in one file (html/css/js), arabic RTL ui
- rooms are identified by a random 4 letter code, they get cleaned up when empty

## features

- create/join rooms with a code
- nicknames + a running score between the two players
- small in-game chat (lives in the room's memory, so it disappears when the room is gone)
- rematch (symbols swap every game, score follows the player)
- handles disconnects
- works on mobile

## deployed

hosted on render free tier: after 15 min of no activity the server sleeps, so the first load takes about a minute.
