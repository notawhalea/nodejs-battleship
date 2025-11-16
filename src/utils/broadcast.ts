import { clients } from "../../index";

export function broadcast(message: any) {
    const data = JSON.stringify(message);
    for (const client of clients.values()) {
        if (client.readyState === client.OPEN) {
            client.send(data);
        }
    }
}