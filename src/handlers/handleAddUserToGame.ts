import { broadcastGameList } from "../utils/broadcastGameList";
import { handleCreateGameSetup } from "./handleCreateGameSetup";
import { games } from "../../index";

export function handleAddUserToGame(ws: any, data: any) {
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