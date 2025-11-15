import { httpServer } from "./src/http_server/index.js";
import { WebSocketServer } from 'ws';

const HTTP_PORT = 3000;

const clients = new Map();
const users = new Map();
const games = new Map();

let nextPlayerIndex = 1;
let nextRoomId = 1;
let currentMove = 1;

const wsServer = new WebSocketServer({ server: httpServer });

wsServer.on('connection', (ws) => {
    const id = Date.now();
    clients.set(id, ws);
    ws.connectionId = id;

    console.log(`New client connected with ID: ${id}`);

    ws.on('message', (message) => {
        handleMessage(ws, message.toString(), id);
    });

    ws.on('close', () => {
        const userId = ws.userId;
        clients.delete(ws.connectionId);

        if (userId) {
            users.delete(userId);
            broadcastGameList();
            console.log(`User ID ${userId} disconnected.`);
        }
    });
});

console.log(`Start static http server on the ${HTTP_PORT} port!`);
httpServer.listen(HTTP_PORT);

function broadcast(message) {
    const data = JSON.stringify(message);
    for (const client of clients.values()) {
        if (client.readyState === client.OPEN) {
            client.send(data);
        }
    }
}

function broadcastGameList() {
    console.log('waiting', Array.from(games.values()))
    const availableRooms = Array.from(games.values())
        .filter(room => room.status === 'waiting')
        .map(room => {
            const player1 = users.get(room.players[0]);
            return {
                roomId: room.id,
                roomUsers: [
                    {
                        name: player1 ? player1.name : `Игрок ${room.players[0]}`,
                        index: player1.index,
                    }
                ]
            };
        });

    broadcast({
        type: 'update_room',
        data: JSON.stringify(availableRooms),
        id: 0
    });
}

function broadcastWinnersList() {
    const winners = Array.from(users.values())
        .filter(user => user.wins > 0)
        .sort((a, b) => b.wins - a.wins);

    const winnersPayload = winners.map(user => ({
        name: user.name,
        wins: user.wins
    }));

    broadcast({
        type: 'update_winners',
        data: JSON.stringify(winnersPayload),
        id: 0
    });
}

function handleRegistration(ws, data) {
    const { name, password } = data;
    let responsePayload = { name: name, error: true, errorText: '' };
    let userId = 0;

    let existingUser = Array.from(users.values()).find(user => user.name === name);

    if (existingUser) {
        if (existingUser.password === password) {
            responsePayload.error = false;
            responsePayload.index = existingUser.index;
            userId = existingUser.index;
        } else {
            responsePayload.errorText = 'Неверный пароль.';
        }
    } else {
        const newUser = {
            index: nextPlayerIndex++,
            name: name,
            password: password,
            wins: 0,
            games: 0
        };
        users.set(newUser.index, newUser);

        responsePayload.error = false;
        responsePayload.errorText = '';
        responsePayload.index = newUser.index;
        userId = newUser.index;
    }

    ws.send(JSON.stringify({
        type: 'reg',
        data: JSON.stringify(responsePayload),
        id: 0
    }));

    if (!responsePayload.error) {
        ws.userId = userId;
        console.log(`User ${name} logged in/registered with ID ${userId}.`);
        broadcastGameList();
        broadcastWinnersList();
    }
}

function handleAttack(ws, data) {
    console.log(`[STUB] Attack requested by ${ws.userId} at (${data.x}, ${data.y}) in game ${data.gameId}`);
}

function handleMessage(ws, message, id) {
    try {
        const parsedMessage = JSON.parse(message);
        let messageData = parsedMessage.data;

        if (typeof messageData === 'string' && messageData.length > 0) {
            messageData = JSON.parse(messageData);
        }
        console.log(`Received message from ${id} (Type: ${parsedMessage.type})`);

        switch (parsedMessage.type) {
            case 'reg':
                handleRegistration(ws, messageData);
                break;

            case 'create_room':
                handleCreateRoom(ws);
                break;

            case 'create_game':
                handleCreateGame(ws);
                break;

            case 'add_user_to_room':
                handleAddUserToGame(ws, messageData);
                break;

            case 'add_ships':
                handleAddShips(ws, messageData);
                break;

            case 'attack':
                handleAttack(ws, parsedMessage.data);
                break;

            default:
                console.log(`Unknown or unimplemented message type: ${parsedMessage.type}`);
        }

    } catch (e) {
        console.error("Error parsing message or during handling:", e);
    }
}

function handleCreateGame(ws) {
    const userId = ws.userId;
    if (!userId) return;

    const existingRoom = Array.from(games.values()).find(room => room.players.includes(userId) && room.status !== 'finished');
    if (existingRoom) {
        console.warn(`User ${userId} already in a room.`);
        return;
    }

    const roomId = nextRoomId++;
    const newRoom = {
        id: roomId,
        players: [userId],
        status: 'waiting',
        playerShips: {},
        playerWs: {}
    };
    games.set(roomId, newRoom);

    console.log(`Room ${roomId} created by user ${userId}.`);
    broadcastGameList();
}

function handleCreateRoom(ws) {
    const userId = ws.userId;
    if (!userId) return;

    const existingRoom = Array.from(games.values()).find(room => room.players.includes(userId) && room.status !== 'finished');
    if (existingRoom) {
        console.warn(`User ${userId} already in a room.`);
        return;
    }

    const roomId = nextRoomId++;
    const newRoom = {
        id: roomId,
        players: [userId],
        status: 'waiting',
        playerShips: {},
        playerWs: {}
    };
    games.set(roomId, newRoom);

    console.log(`Room ${roomId} created by user ${userId}.`);
    broadcastGameList();
}

function handleAddShips(ws, data) {
    const { gameId, ships, indexPlayer: userId } = data;
    const room = games.get(gameId);

    if (!room || room.status !== 'placement' || !room.players.includes(userId)) {
        console.warn(`[AddShips] Invalid state or user ${userId} not in room ${gameId}.`);
        return;
    }

    const processedShips = ships.map(ship => {
        const allPositions = [];
        const { x: startX, y: startY } = ship.position;
        const directionIsVertical = ship.direction;

        for (let i = 0; i < ship.length; i++) {
            let currentX = startX;
            let currentY = startY;

            if (directionIsVertical) {
                currentY += i;
            } else {
                currentX += i;
            }

            allPositions.push({ x: currentX, y: currentY, hit: false });
        }

        return {
            ...ship,
            position: allPositions,
            hits: 0
        };
    });

    room.playerShips[userId] = processedShips;

    const [p1Id, p2Id] = room.players;
    if (room.playerShips[p1Id] && room.playerShips[p2Id]) {
        room.status = 'playing';

        const firstPlayerId = Math.random() < 0.5 ? p1Id : p2Id;
        room.currentPlayer = firstPlayerId;

        console.log(`Game ${room.id} started! First turn: ${firstPlayerId}`);
        sendStartGame(room);
        sendTurn(room);
    }
}

function sendStartGame(room) {
    const [p1Id, p2Id] = room.players;

    room.playerWs[p1Id].send(JSON.stringify({
        type: 'start_game',
        data: JSON.stringify({
            currentPlayerIndex: p1Id,
            ships: room.playerShips[p2Id].map(ship => ({
                length: ship.length,
                type: ship.type,
                direction: ship.direction,
                position: {
                    x: ship.position.x,
                    y: ship.position.y
                }
            }))
        }),
        id: 0
    }));

    room.playerWs[p2Id].send(JSON.stringify({
        type: 'start_game',
        data: JSON.stringify({
            currentPlayerIndex: p2Id,
            ships: room.playerShips[p1Id].map(ship => ({
                length: ship.length,
                type: ship.type,
                direction: ship.direction,
                position: {
                    x: ship.position.x,
                    y: ship.position.y
                }
            }))
        }),
        id: 0
    }));
}

function handleAddUserToGame(ws, data) {
    const userId2 = ws.userId;
    const roomId = data.indexRoom;

    const room = games.get(roomId);

    if (!room || room.status !== 'waiting' || room.players.length !== 1 || room.players.includes(userId2)) {
        console.warn(`Attempt by ${userId2} to join invalid room ${roomId}`);
        return;
    }

    room.players.push(userId2);
    room.status = 'placement';

    broadcastGameList();
    handleCreateGameSetup(room);
}

function handleCreateGameSetup(room) {
    const [p1Id, p2Id] = room.players;

    const ws1 = Array.from(clients.values()).find(c => c.userId === p1Id);
    const ws2 = Array.from(clients.values()).find(c => c.userId === p2Id);

    if (!ws1 || !ws2) {
        games.delete(room.id);
        broadcastGameList();
        return;
    }

    room.playerWs = { [p1Id]: ws1, [p2Id]: ws2 };
    room.playerShips = { [p1Id]: null, [p2Id]: null };

    ws1.send(JSON.stringify({
        type: 'create_game',
        data: JSON.stringify({
            idGame: room.id,
            idPlayer: p1Id
        }),
        id: 0
    }));

    ws2.send(JSON.stringify({
        type: 'create_game',
        data: JSON.stringify({
            idGame: room.id,
            idPlayer: p2Id
        }),
        id: 0
    }));
}

function sendTurn(room) {
    const turnMessage = JSON.stringify({
        type: 'turn',
        data: JSON.stringify({
            currentPlayer: currentMove
        }),
        id: 0
    });
    const [p1Id, p2Id] = room.players;

    const ws1 = Array.from(clients.values()).find(c => c.userId === p1Id);
    const ws2 = Array.from(clients.values()).find(c => c.userId === p2Id);

    ws1.send(turnMessage);
    ws2.send(turnMessage);
    if (currentMove === 1) {
        currentMove = 2
    } else {
        currentMove = 1
    }
}