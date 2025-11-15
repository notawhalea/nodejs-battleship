// src/game.ts
import {
    Ship,
    GameBoard,
    BoardCell,
    Position,
    GameStatus,
    SendToPlayerFn,
    BroadcastToGameFn,
    OnGameWonFn,
    User,
} from './types';

export class Game {
    public gameId: number;
    public playerIds: [number, number];
    public spectators: number[] = []; // Для 105 баллов
    public status: GameStatus = 'pending';
    public currentPlayerId: number;

    private boards: Map<number, GameBoard> = new Map();
    private ships: Map<number, Ship[]> = new Map();
    private shipHealth: Map<number, Map<Ship, number>> = new Map();

    // Коллбэки для связи с index.ts
    private sendTo: SendToPlayerFn;
    private broadcast: BroadcastToGameFn;
    private onGameWon: OnGameWonFn;

    constructor(
        gameId: number,
        player1Id: number,
        player2Id: number,
        sendTo: SendToPlayerFn,
        broadcast: BroadcastToGameFn,
        onGameWon: OnGameWonFn
    ) {
        this.gameId = gameId;
        this.playerIds = [player1Id, player2Id];
        this.currentPlayerId = player1Id; // Игрок 1 ходит первым
        this.sendTo = sendTo;
        this.broadcast = broadcast;
        this.onGameWon = onGameWon;
    }

    /** Игрок добавляет свои корабли */
    addShips(playerId: number, ships: Ship[]) {
        if (this.status !== 'pending') return;

        // TODO: ВАЛИДАЦИЯ КОРАБЛЕЙ
        // Это критически важный шаг для 105 баллов.
        // 1. Проверить кол-во (1x4, 2x3, 3x2, 4x1)
        // 2. Проверить, что не выходят за поле (0-9)
        // 3. Проверить, что не касаются друг друга (углами и сторонами)
        // const isValid = this.validateShips(ships);
        // if (!isValid) {
        //   this.sendTo(playerId, 'error', { message: 'Invalid ship placement' });
        //   return;
        // }

        // Создаем доску 10x10 и "рисуем" корабли
        const board: GameBoard = Array(10).fill(null).map(() => Array(10).fill(0));
        const healthMap = new Map<Ship, number>();

        for (const ship of ships) {
            healthMap.set(ship, ship.length); // Устанавливаем "здоровье" корабля
            for (let i = 0; i < ship.length; i++) {
                const x = ship.position.x + (ship.direction ? 0 : i);
                const y = ship.position.y + (ship.direction ? i : 0);
                board[y][x] = 1; // 1 = Корабль
            }
        }

        this.ships.set(playerId, ships);
        this.boards.set(playerId, board);
        this.shipHealth.set(playerId, healthMap);

        console.log(`Игрок ${playerId} расставил корабли в игре ${this.gameId}`);

        // Проверяем, готовы ли оба игрока
        if (this.ships.has(this.playerIds[0]) && this.ships.has(this.playerIds[1])) {
            this.startGame();
        }
    }

    private startGame() {
        this.status = 'playing';
        console.log(`Игра ${this.gameId} началась!`);

        // Отправляем каждому его поле
        this.sendTo(this.playerIds[0], 'start_game', {
            ships: this.ships.get(this.playerIds[0]),
            currentPlayerIndex: this.currentPlayerId,
        });
        this.sendTo(this.playerIds[1], 'start_game', {
            ships: this.ships.get(this.playerIds[1]),
            currentPlayerIndex: this.currentPlayerId,
        });

        // Сообщаем, чей ход
        this.broadcast(this.getAllParticipants(), 'turn', {
            currentPlayer: this.currentPlayerId,
        });
    }

    /** Игрок атакует */
    attack(attackerId: number, x: number, y: number) {
        if (this.status !== 'playing') return;
        if (attackerId !== this.currentPlayerId) {
            this.sendTo(attackerId, 'error', { message: 'Not your turn' });
            return;
        }

        const opponentId = this.playerIds.find((id) => id !== attackerId)!;
        const opponentBoard = this.boards.get(opponentId)!;
        const cell = opponentBoard[y][x];

        if (cell === 2 || cell === 3) {
            this.sendTo(attackerId, 'error', { message: 'Already attacked' });
            return;
        }

        if (cell === 0) {
            // === Промах ===
            opponentBoard[y][x] = 3; // 3 = Промах
            this.broadcast(this.getAllParticipants(), 'attack', {
                position: { x, y },
                currentPlayer: attackerId,
                status: 'miss',
            });
            this.switchTurn();
            return;
        }

        if (cell === 1) {
            // === Попадание ===
            opponentBoard[y][x] = 2; // 2 = Попадание

            // TODO: Логика "Убил"
            // 1. Найти корабль, в который попали
            // 2. Уменьшить его "здоровье" в this.shipHealth
            // 3. Если здоровье 0:
            //    const killedShip = ...
            //    this.markAroundKilledShip(opponentId, killedShip); // (105 баллов)
            //    this.broadcast(..., 'attack', { ..., status: 'kill', ship: killedShip });
            //
            //    // TODO: Логика "Победа"
            //    if (this.checkWin(opponentId)) {
            //      this.handleWin(attackerId);
            //      return;
            //    }
            //    // Если не победа, ход НЕ передается
            //    this.broadcast(this.getAllParticipants(), 'turn', { currentPlayer: this.currentPlayerId });
            //    return;

            // Временная логика (без "убил")
            this.broadcast(this.getAllParticipants(), 'attack', {
                position: { x, y },
                currentPlayer: attackerId,
                status: 'hit',
            });
            // Ход не передается
            this.broadcast(this.getAllParticipants(), 'turn', {
                currentPlayer: this.currentPlayerId,
            });
        }
    }

    /** Обработка выхода игрока (для 105 баллов) */
    handlePlayerDisconnect(playerId: number) {
        if (this.status !== 'playing') return;

        // TODO: Запустить таймер переподключения.
        // Если таймер истек, засчитать поражение.

        // Пока (для 60 баллов) - мгновенное поражение
        const winnerId = this.playerIds.find(id => id !== playerId)!;
        this.handleWin(winnerId);
    }

    private switchTurn() {
        this.currentPlayerId = this.playerIds.find(
            (id) => id !== this.currentPlayerId
        )!;
        this.broadcast(this.getAllParticipants(), 'turn', {
            currentPlayer: this.currentPlayerId,
        });
    }

    private handleWin(winnerId: number) {
        this.status = 'finished';
        this.broadcast(this.getAllParticipants(), 'finish', { winPlayer: winnerId });
        this.onGameWon(winnerId); // Сообщаем index.ts, что игра окончена
    }

    /** Возвращает ID игроков и зрителей */
    private getAllParticipants(): number[] {
        return [...this.playerIds, ...this.spectators];
    }
}