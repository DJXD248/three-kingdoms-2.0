
export type NetworkMessage = {
  type: string;
  payload: unknown;
};

export class MessageRouter {
  route(message: NetworkMessage) {
    switch (message.type) {
      case "ACTION":
        return message.payload;
      case "SYNC":
        return message.payload;
      default:
        return null;
    }
  }
}
