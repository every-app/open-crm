import { createSerializationAdapter } from "@tanstack/react-router";
import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { globalServerFunctionMiddleware } from "@/serverFunctions/middleware";
import { UserMessageError } from "@/shared/error-codes";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

// Start sends an error to the browser as its message (the code) alone; one
// the server wrote for people keeps its words.
const userMessageErrors = createSerializationAdapter({
  key: "user-message-error",
  test: (value): value is UserMessageError => value instanceof UserMessageError,
  toSerializable: ({ code, userMessage }) => ({ code, userMessage }),
  fromSerializable: ({ code, userMessage }) =>
    new UserMessageError(code, userMessage),
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
  functionMiddleware: globalServerFunctionMiddleware,
  serializationAdapters: [userMessageErrors],
}));
