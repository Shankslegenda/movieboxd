import { useEffect, useState } from "react";
export class RequestError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}
export function useApi<T>(url: string | null) {
  const [state, setState] = useState<{
    url: string | null;
    data?: T;
    error?: RequestError;
    loading: boolean;
  }>({ url, loading: !!url });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!url) {
      setState({ url, loading: false });
      return;
    }
    const controller = new AbortController();
    setState({ url, loading: true });
    (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok)
          throw new RequestError(
            body.message || "Не удалось загрузить данные.",
            body.code || "REQUEST_FAILED",
          );
        if (!controller.signal.aborted)
          setState({ url, data: body, loading: false });
      } catch (error) {
        if (!controller.signal.aborted)
          setState({
            url,
            error:
              error instanceof RequestError
                ? error
                : new RequestError(
                    "Не удалось связаться с сервером. Проверьте подключение.",
                    "NETWORK_ERROR",
                  ),
            loading: false,
          });
      }
    })();
    return () => controller.abort();
  }, [url, version]);
  return {
    ...(state.url === url
      ? state
      : { loading: !!url, data: undefined, error: undefined }),
    retry: () => setVersion((v) => v + 1),
  };
}
