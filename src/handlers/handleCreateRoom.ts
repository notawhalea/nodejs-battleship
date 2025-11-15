import { broadcastGameList } from "../utils/broadcastGameList";
import { games } from "../../index";

export function handleCreateRoom(ws: any, nextRoomId: any) {
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