import { broadcast } from "./broadcast";
import { users } from "../../index";

export function broadcastWinnersList() {
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