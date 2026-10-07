import { createRequestHandler } from "react-router";
import { getLoadContext } from "../app/load-context";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, getLoadContext({ env, ctx }));
  },
} satisfies ExportedHandler<Env>;
