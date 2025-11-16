import { httpServer } from "./src/server";
import { WebSocketServer } from 'ws';
import { broadcastWinnersList } from "./src/utils/broadcastWinnersList";
import { broadcastGameList } from "./src/utils/broadcastGameList";
import { handleCreateRoom } from "./src/handlers/handleCreateRoom";
import { handleAddUserToGame } from "./src/handlers/handleAddUserToGame";

const HTTP_PORT = 3000;

export const clients = new Map();
export const users = new Map();
export const games = new Map();

let nextPlayerIndex = 1;
let nextRoomId = 1;

const wsServer = new WebSocketServer({ server: httpServer });

wsServer.on('connection', (ws:  any) => {
    const id = Date.now();
    clients.set(id, ws);
    ws.connectionId = id;

    console.log(`New client connected with ID: ${id}`);

    ws.on('message', (message: any) => {
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

function handleRegistration(ws: any, data: any) {
    const { name, password } = data;
    let responsePayload = { name: name, error: true, errorText: '', index: 0 };
    let userId = 0;

    let existingUser = Array.from(users.values()).find(user => user.name === name);

    if (existingUser) {
        if (existingUser.password === password) {
            responsePayload.error = false;
            responsePayload.index = existingUser.index;
            userId = existingUser.index;
        } else {
            responsePayload.errorText = 'Wrong password';
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

function handleMessage(ws: any, message: any, id: any) {
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
                handleCreateRoom(ws, nextRoomId);
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
                handleAttack(ws, messageData)
                break;

            case 'randomAttack':
                handleRandomAttack(ws, messageData);
                break;

            default:
                console.log(`Unknown or unimplemented message type: ${parsedMessage.type}`);
        }

    } catch (e) {
        console.error("Error parsing message or during handling:", e);
    }
}

function handleCreateGame(ws: any) {
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

function handleAddShips(ws: any, data: any) {
    const { gameId, ships, indexPlayer: userId } = data;
    const room = games.get(gameId);

    if (!room || room.status !== 'placement' || !room.players.includes(userId)) {
        console.warn(`[AddShips] Invalid state or user ${userId} not in room ${gameId}.`);
        return;
    }

    const processedShips = ships.map((ship: any) => {
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
        handleSendTurn(room, firstPlayerId);
    }
}

function handleAttack(ws: any, data: any): void {
    const attackerId = data.indexPlayer;
    const { x, y, gameId } = data;

    const room = games.get(gameId);
    if (!room || room.status !== 'playing' || room.currentPlayer !== attackerId) {
        return;
    }

    const defenderId = room.players.find((id: any) => id !== attackerId)!;
    const defenderShips = room.playerShips[defenderId];

    let result: 'miss' | 'shot' | 'killed' = 'miss';
    let killedShipPositions: { x: number; y: number }[] | undefined = undefined;

    for (const ship of defenderShips) {
        const hitPart = ship.position.find((pos: any) => pos.x === x && pos.y === y && !pos.hit);

        if (hitPart) {
            hitPart.hit = true;
            ship.hits++;

            if (ship.hits === ship.position.length) {
                result = 'killed';
                killedShipPositions = ship.position.map((pos: any) => ({x: pos.x, y: pos.y}));
            } else {
                result = 'shot';
            }
            break;
        }
    }

    const primaryResponseData = {
        position: { x, y },
        currentPlayer: attackerId,
        status: result
    };

    const primaryMessage = JSON.stringify({ type: 'attack', data: JSON.stringify(primaryResponseData), id: 0 });
    room.playerWs[attackerId].send(primaryMessage);
    room.playerWs[defenderId].send(primaryMessage);

    if (result === 'killed' && killedShipPositions) {
        const surroundingCells = getCellsAroundShip(killedShipPositions);

        const missResponseData = {
            currentPlayer: attackerId,
            status: 'miss',
            position: {x: 0, y: 0}
        };

        const wsList = [room.playerWs[attackerId], room.playerWs[defenderId]];

        for (const cell of surroundingCells) {
            missResponseData.position = cell;
            const missMessage = JSON.stringify({ type: 'attack', data: JSON.stringify(missResponseData), id: 0 });

            wsList[0].send(missMessage);
            wsList[1].send(missMessage);
        }
    }

    if (result === 'killed' && checkWinCondition(defenderShips)) {
        handleFinish(room, attackerId)
    }

    if (result === 'miss') {
        const nextPlayerId = defenderId;
        room.currentPlayer = nextPlayerId;
        handleSendTurn(room, nextPlayerId);
    } else {
        handleSendTurn(room, attackerId);
    }
}

function checkWinCondition(ships: any): boolean {
    return ships.every((ship: any) => ship.hits === ship.position.length);
}

function handleFinish(room: any, winnerId: number): void {
    const loserId = room.players.find((id: any) => id !== winnerId)!;

    room.status = 'finished';

    const winner = users.get(winnerId);
    const loser = users.get(loserId);

    if (winner) {
        winner.wins += 1;
        winner.games += 1;
    }
    if (loser) {
        loser.games += 1;
    }

    const finishResponseData = {
        winPlayer: winnerId,
    };

    const finishMessage = JSON.stringify({
        type: 'finish',
        data: JSON.stringify(finishResponseData),
        id: 0
    });

    room.playerWs[winnerId].send(finishMessage);
    room.playerWs[loserId].send(finishMessage);

    broadcastWinnersList();

    games.delete(room.id);
}

function getCellsAroundShip(shipPositions: { x: number; y: number }[]): { x: number; y: number }[] {
    const surroundings = new Set<string>();

    const minX = Math.min(...shipPositions.map(p => p.x));
    const maxX = Math.max(...shipPositions.map(p => p.x));
    const minY = Math.min(...shipPositions.map(p => p.y));
    const maxY = Math.max(...shipPositions.map(p => p.y));

    for (let x = minX - 1; x <= maxX + 1; x++) {
        for (let y = minY - 1; y <= maxY + 1; y++) {
            const isShipCell = shipPositions.some(p => p.x === x && p.y === y);

            if (x >= 0 && x <= 9 && y >= 0 && y <= 9 && !isShipCell) {
                surroundings.add(`${x},${y}`);
            }
        }
    }

    return Array.from(surroundings).map(s => {
        const [x, y] = s.split(',').map(Number);
        return { x, y };
    });
}

function handleRandomAttack(ws: any, data: any): void {
    const attackerId = data.indexPlayer;
    const room = games.get(data.gameId);

    if (!room || room.status !== 'playing' || room.currentPlayer !== attackerId) {
        return;
    }

    const defenderId = room.players.find((id: any) => id !== attackerId)!;
    const defenderShips = room.playerShips[defenderId];

    const attackedCoordinates: Set<string> = new Set();

    defenderShips.forEach((ship: any) => {
        ship.position.filter((pos: any) => pos.hit).forEach((pos: any) => {
            attackedCoordinates.add(`${pos.x},${pos.y}`);
        });
    });

    const untargetedCoordinates: { x: number, y: number }[] = [];
    for (let x = 0; x < 10; x++) {
        for (let y = 0; y < 10; y++) {
            const coordKey = `${x},${y}`;
            if (!attackedCoordinates.has(coordKey)) {
                untargetedCoordinates.push({ x, y });
            }
        }
    }

    if (untargetedCoordinates.length === 0) {
        console.warn(`[RandomAttack] No untargeted cells found for ${attackerId}.`);
        return;
    }

    const randomIndex = Math.floor(Math.random() * untargetedCoordinates.length);
    const randomTarget = untargetedCoordinates[randomIndex];

    const attackData = {
        gameId: data.gameId,
        x: randomTarget.x,
        y: randomTarget.y,
        indexPlayer: attackerId
    };

    handleAttack(ws, attackData);
}

function sendStartGame(room: any) {
    const [p1Id, p2Id] = room.players;

    room.playerWs[p1Id].send(JSON.stringify({
        type: 'start_game',
        data: JSON.stringify({
            currentPlayerIndex: p1Id,
            ships: room.playerShips[p2Id].map((ship: any) => ({
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
            ships: room.playerShips[p1Id].map((ship: any) => ({
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

function handleSendTurn(room: any, nextMove: any) {
    const turnMessage = JSON.stringify({
        type: 'turn',
        data: JSON.stringify({
            currentPlayer: nextMove
        }),
        id: 0
    });
    const [p1Id, p2Id] = room.players;

    const ws1 = Array.from(clients.values()).find(c => c.userId === p1Id);
    const ws2 = Array.from(clients.values()).find(c => c.userId === p2Id);

    ws1.send(turnMessage);
    ws2.send(turnMessage);
}