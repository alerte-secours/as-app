import { ApolloLink, Observable } from "@apollo/client/core";
import { print } from "graphql";
// import { createClient } from "graphql-ws";
import { createRestartableClient } from "./graphqlWs";
import network from "~/network";

export default class WebSocketLink extends ApolloLink {
  constructor(options) {
    super();
    // const client = createClient(options);
    const client = createRestartableClient(options);
    this.client = client;
    network.wsClient = client;
  }

  request(operation) {
    return new Observable((sink) => {
      return this.client.subscribe(
        { ...operation, query: print(operation.query) },
        {
          next: sink.next.bind(sink),
          complete: sink.complete.bind(sink),
          error: (err) => {
            // Don't propagate client restart events as errors
            if (err.code === 4205) {
              // Gracefully complete the subscription instead
              return sink.complete();
            }

            if (Array.isArray(err)) {
              return sink.error(
                new Error(err.map(({ message }) => message).join(", ")),
              );
            }

            if (err.code) {
              return sink.error(
                new Error(
                  `Socket closed with event ${err.code} ${err.reason || ""}`, // reason will be available on clean closes only
                ),
              );
            }

            return sink.error(err);
          },
        },
      );
    });
  }
}
