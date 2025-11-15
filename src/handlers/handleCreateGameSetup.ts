import { broadcastGameList } from "../utils/broadcastGameList";
import { clients, games } from "../../index";

export function handleCreateGameSetup(room: any) {
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