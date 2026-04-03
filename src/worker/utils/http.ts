export function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

export function textResponse(body: string, status = 200, headers?: HeadersInit): Response {
  return new Response(body, {
    status,
    headers,
  });
}

export function emptyResponse(status = 204, headers?: HeadersInit): Response {
  return new Response(null, { status, headers });
}

export async function readJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

export function errorResponse(
  requestId: string,
  status: number,
  code: string,
  message: string,
): Response {
  return jsonResponse(
    {
      error: {
        code,
        message,
        requestId,
      },
    },
    status,
  );
}
