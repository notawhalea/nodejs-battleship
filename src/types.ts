// src/types.ts
import { WebSocket } from 'ws';

// === Базовые игровые сущности ===

export interface Position {
    x: number;
    y: number;
}

export type ShipType = 'huge' | 'large' | 'medium' | 'small';

export interface Ship {
    position: Position;
    direction: boolean; // false - horizontal, true - vertical
    length: number;
    type: ShipType;
}

// 0 - empty, 1 - ship, 2 - hit, 3 - miss (around killed)
export type BoardCell = 0 | 1 | 2 | 3;
export type GameBoard = BoardCell[][];

export interface Winner {
    name: string;
    wins: number;
}

// === Структуры данных сервера ===

// Расширяем стандартный WebSocket, чтобы хранить ID пользователя
export interface WebSocketWithId extends WebSocket {
    userId: number;
}

export interface User {
    ws: WebSocketWithId;
    name: string;
    currentGameId: number | null;
}

export interface Room {
    roomId: number;
    roomUsers: { name: string; index: number }[]; // Только 1 игрок при создании
}

// === Типы сообщений (Контракт с клиентом) ===

// --- Сообщения от клиента (Входящие) ---

type RegMessage = {
    type: 'reg';
    data: {
        name: string;
        index?: number; // Для переподключения
    };
};

type CreateRoomMessage = {
    type: 'create_room';
    data: null;
};

type AddUserToRoomMessage = {
    type: 'add_user_to_room';
    data: {
        indexRoom: number; // roomId
    };
};

type AddShipsMessage = {
    type: 'add_ships';
    data: {
        gameId: number;
        ships: Ship[];
        indexPlayer: number;
    };
};

type AttackMessage = {
    type: 'attack';
    data: {
        gameId: number;
        x: number;
        y: number;
        indexPlayer: number;
    };
};

type RandomAttackMessage = {
    type: 'randomAttack';
    data: {
        gameId: number;
        indexPlayer: number;
    };
};

// ... (Добавим `single_play` и `add_spectator` позже)

// Тип для всех входящих сообщений
export type ClientMessage =
    | RegMessage
    | CreateRoomMessage
    | AddUserToRoomMessage
    | AddShipsMessage
    | AttackMessage
    | RandomAttackMessage;

// --- Сообщения от сервера (Исходящие) ---

export type RegResponse = {
    type: 'reg';
    data: {
        name: string;
        index: number;
        error: boolean;
        errorText?: string;
    };
};

export type UpdateRoomResponse = {
    type: 'update_room';
    data: Room[]; // Полный список комнат
};

export type UpdateWinnersResponse = {
    type: 'update_winners';
    data: Winner[]; // Полный список победителей
};

// ... (и так далее для 'start_game', 'attack', 'turn', 'finish')

export type GameStatus = 'pending' | 'playing' | 'finished';

// === Сообщения от сервера (Исходящие) - ДОПОЛНЕНИЯ ===

export type CreateGameResponse = {
    type: 'create_game';
    data: {
        idGame: number;
        idPlayer: number; // Ваш ID
    };
};

export type StartGameResponse = {
    type: 'start_game';
    data: {
        ships: Ship[]; // Ваши корабли
        currentPlayerIndex: number; // Чей ход
    };
};

export type TurnResponse = {
    type: 'turn';
    data: {
        currentPlayer: number; // ID игрока, который ходит
    };
};

export type AttackStatus = 'miss' | 'hit' | 'kill';

export type AttackResponse = {
    type: 'attack';
    data: {
        position: Position;
        currentPlayer: number; // ID того, кто атаковал
        status: AttackStatus;
        ship?: Ship; // Отправляем, если status === 'kill'
    };
};

export type FinishResponse = {
    type: 'finish';
    data: {
        winPlayer: number; // ID победителя
    };
};

// Обновляем общий тип
export type ServerMessage =
    | RegResponse
    | UpdateRoomResponse
    | UpdateWinnersResponse
    | CreateGameResponse
    | StartGameResponse
    | TurnResponse
    | AttackResponse
    | FinishResponse;

// === Типы для коллбэков ===
// Функции, которые Game будет вызывать в index.ts

export type SendToPlayerFn = (
    playerId: number,
    type: string,
    data: any
) => void;

export type BroadcastToGameFn = (
    playerIds: number[],
    type: string,
    data: any
) => void;

export type OnGameWonFn = (winnerId: number) => void;