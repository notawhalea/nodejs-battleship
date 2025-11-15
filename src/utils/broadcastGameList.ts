import { broadcast } from "./broadcast";
import { games, users } from "../../index";

export function broadcastGameList() {
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