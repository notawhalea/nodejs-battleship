// src/index.ts
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import {
    ClientMessage,
    User,
    Room,
    Winner,
    WebSocketWithId
} from './types';
// Импортируем класс Game (создадим его в следующем шаге)
import { Game } from './game';

const port = process.env.PORT || 3000;
const server = createServer();
const wss = new WebSocketServer({ server });

// === Хранилища данных ===
const users = new Map<number, User>();
const rooms = new Map<number, Room>();
const games = new Map<number, Game>(); // <-- Добавляем хранилище игр
const winners: Winner[] = [];

let nextUserId = 0;
let nextRoomId = 0;
let nextGameId = 0;

// === Обработка подключений ===

wss.on('connection', (ws: WebSocket) => {
    // Мы не знаем ID пользователя, пока он не пришлет 'reg'
    console.log('Новый клиент подключился');

    ws.on('message', (message: Buffer) => {
        try {
            const parsedMessage: ClientMessage = JSON.parse(message.toString());

            // 'reg' - единственный тип, который может прийти от незарегистрированного ws
            if (parsedMessage.type === 'reg') {
                handleRegistration(ws, parsedMessage.data);
            } else {
                // Для всех остальных сообщений у ws уже должен быть userId
                const wsWithId = ws as WebSocketWithId;
                if (!wsWithId.userId) {
                    console.error('Сообщение от неавторизованного пользователя');
                    return;
                }
                handleMessage(wsWithId, parsedMessage);
            }
        } catch (e) {
            console.error('Ошибка парсинга JSON или типа сообщения:', e);
        }
    });

    ws.on('close', () => {
        // ws здесь может быть еще без userId
        const wsWithId = ws as WebSocketWithId;
        if (wsWithId.userId) {
            console.log(`Клиент ${wsWithId.userId} отключился`);
            handleDisconnect(wsWithId);
        } else {
            console.log('Неавторизованный клиент отключился');
        }
    });

    ws.on('error', (e) => console.error(e));
});

// === Логика сообщений ===

function handleRegistration(ws: WebSocket, data: { name: string; index?: number }) {
    const { name, index } = data;

    // 1. Логика переподключения (Advanced Scope)
    if (index !== undefined && users.has(index)) {
        const userId = index;
        const user = users.get(userId)!;

        console.log(`Пользователь ${user.name} (ID: ${userId}) переподключился.`);

        // Привязываем ID к новому сокету
        const wsWithId = ws as WebSocketWithId;
        wsWithId.userId = userId;

        // Обновляем сокет в хранилище
        user.ws = wsWithId;

        sendTo(wsWithId, 'reg', { name: user.name, index: userId, error: false });

        // ... (Здесь будет логика восстановления игры) ...
        // ...

    } else {
        // 2. Новая регистрация
        const userId = nextUserId++;
        const wsWithId = ws as WebSocketWithId;
        wsWithId.userId = userId; // Теперь у сокета есть ID

        const newUser: User = {
            ws: wsWithId,
            name: name,
            currentGameId: null,
        };
        users.set(userId, newUser);
        console.log(`Новый пользователь ${name} (ID: ${userId}) зарегистрирован.`);

        sendTo(wsWithId, 'reg', { name: name, index: userId, error: false });
    }

    // 3. Отправляем списки (всем нужен актуальный список)
    broadcastRoomUpdate();
    broadcastWinnersUpdate();
}

function handleMessage(ws: WebSocketWithId, message: ClientMessage) {
    const userId = ws.userId;
    const user = users.get(userId);
    if (!user) return;

    // Ищем игру, если пользователь в ней
    const game = user.currentGameId !== null ? games.get(user.currentGameId) : undefined;

    switch (message.type) {
        case 'create_room':
            handleCreateRoom(user);
            break;

        case 'add_user_to_room':
            handleAddUserToRoom(user, message.data.indexRoom);
            break;

        case 'add_ships':
            if (game) {
                game.addShips(userId, message.data.ships);
            }
            break;

        case 'attack':
            if (game) {
                game.attack(userId, message.data.x, message.data.y);
            }
            break;

        // TODO: 'randomAttack'

        // TODO: 'single_play'
    }
}

function handleDisconnect(ws: WebSocketWithId) {
    const userId = ws.userId;
    const user = users.get(userId);
    if (!user) return;

    // **Логика Basic Scope (Простое отключение):**

    // Если он был в комнате ожидания, удаляем комнату
    const roomToRemove = Array.from(rooms.values()).find(
        (r) => r.roomUsers[0].index === userId
    );
    if (roomToRemove) {
        rooms.delete(roomToRemove.roomId);
        broadcastRoomUpdate(); // Обновляем список комнат у всех
    }

    // Если он был в игре
    if (user.currentGameId !== null) {
        const game = games.get(user.currentGameId);
        if (game && game.status === 'playing') {
            // Сообщаем игре, что игрок вышел (для 60 баллов - это поражение)
            game.handlePlayerDisconnect(userId);
        }
    }

    users.delete(userId); // Удаляем пользователя
    console.log(`Пользователь ${user.name} удален.`);
}

// === Хелперы ===

/** Отправить сообщение одному клиенту */
function sendTo(ws: WebSocket, type: string, data: any) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, data }));
    }
}

function sendToPlayer(playerId: number, type: string, data: any) {
    const user = users.get(playerId);
    if (user) {
        sendTo(user.ws, type, data);
    }
}

/** Отправить сообщение всем подключенным клиентам */
function broadcast(type: string, data: any) {
    const message = JSON.stringify({ type, data });
    users.forEach((user) => {
        if (user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(message);
        }
    });
}

function broadcastToGame(playerIds: number[], type: string, data: any) {
    playerIds.forEach(id => sendToPlayer(id, type, data));
}

/** Разослать всем обновленный список комнат (для 105 баллов) */
function broadcastRoomUpdate() {
    const roomList = Array.from(rooms.values());
    broadcast('update_room', roomList);
}

/** Разослать всем обновленный список победителей (для 105 баллов) */
function broadcastWinnersUpdate() {
    broadcast('update_winners', winners);
}


// === Логика комнат ===

function handleCreateRoom(user: User) {
    if (user.currentGameId !== null) {
        sendTo(user.ws, 'error', { message: 'You are already in game' });
        return;
    }

    const newRoomId = nextRoomId++;
    const newRoom: Room = {
        roomId: newRoomId,
        roomUsers: [{ name: user.name, index: user.ws.userId }],
    };

    rooms.set(newRoomId, newRoom);
    console.log(`Пользователь ${user.name} создал комнату ${newRoomId}`);
    broadcastRoomUpdate();
}

function handleAddUserToRoom(user: User, roomId: number) {
    const room = rooms.get(roomId);

    if (!room) {
        sendTo(user.ws, 'error', { message: 'Room not found' });
        return;
    }

    if (room.roomUsers.length > 1) {
        sendTo(user.ws, 'error', { message: 'Room is full' });
        return;
    }

    const player1Id = room.roomUsers[0].index;
    const player2Id = user.ws.userId;

    if (player1Id === player2Id) {
        sendTo(user.ws, 'error', { message: 'Cannot join your own room' });
        return;
    }

    // === Создание Игры ===
    const newGameId = nextGameId++;

    // Коллбэк для завершения игры
    const onGameWon = (winnerId: number) => {
        const winner = users.get(winnerId);
        if (winner) {
            console.log(`Игра ${newGameId} завершена. Победитель: ${winner.name}`);
            // TODO: Обновить 'winners'
        }
        // Удаляем игру
        games.delete(newGameId);
        // Освобождаем игроков
        const p1 = users.get(player1Id);
        if (p1) p1.currentGameId = null;
        const p2 = users.get(player2Id);
        if (p2) p2.currentGameId = null;

        // TODO: Разослать 'update_winners'
    };

    const newGame = new Game(
        newGameId,
        player1Id,
        player2Id,
        sendToPlayer,
        broadcastToGame,
        onGameWon
    );

    games.set(newGameId, newGame);

    // Обновляем статус игроков
    const player1 = users.get(player1Id)!;
    const player2 = user;
    player1.currentGameId = newGameId;
    player2.currentGameId = newGameId;

    // Удаляем комнату из списка ожидания
    rooms.delete(roomId);

    console.log(`Игра ${newGameId} создана для ${player1.name} и ${player2.name}`);

    // Рассылаем всем обновленный список комнат (комната исчезла)
    broadcastRoomUpdate();

    // Сообщаем игрокам, что игра создана
    sendToPlayer(player1Id, 'create_game', { idGame: newGameId, idPlayer: player1Id });
    sendToPlayer(player2Id, 'create_game', { idGame: newGameId, idPlayer: player2Id });
}

// === Запуск сервера ===

server.listen(port, () => {
    console.log(`Сервер "Морской бой" (TS) запущен на порту ${port}`);
});