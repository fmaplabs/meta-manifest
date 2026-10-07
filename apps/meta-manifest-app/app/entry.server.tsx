import { renderToReadableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import type { AppLoadContext, EntryContext } from "react-router";
import { isbot } from "isbot";

export const streamTimeout = 5000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
  loadContext: AppLoadContext,
) {
  loadContext.shopify.addDocumentResponseHeaders(request, responseHeaders);

  let shellRendered = false;

  // Abort the React renderer once loaders have had their streamTimeout,
  // so rejected boundary contents still flush before the stream closes.
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    streamTimeout + 1000,
  );

  const body = await renderToReadableStream(
    <ServerRouter context={reactRouterContext} url={request.url} />,
    {
      signal: controller.signal,
      onError(error: unknown) {
        responseStatusCode = 500;
        // Errors thrown during initial shell rendering are reported by the
        // awaited renderToReadableStream rejecting; only log the rest.
        if (shellRendered) {
          console.error(error);
        }
      },
    },
  );
  shellRendered = true;

  const userAgent = request.headers.get("user-agent");
  if (userAgent && isbot(userAgent)) {
    await body.allReady;
  }

  body.allReady.then(() => clearTimeout(timeoutId)).catch(() => {});

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
