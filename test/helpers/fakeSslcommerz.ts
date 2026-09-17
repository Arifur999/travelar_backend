/**
 * A stand-in for SSLCommerz, installed by replacing `fetch` in the test process.
 *
 * The API runs in-process (helpers/app.ts), so its calls to the gateway go
 * through this same global. Requests to the SSLCommerz hosts are answered here;
 * everything else — the test client's own calls to 127.0.0.1 — passes through.
 *
 * Deliberately not a production knob. `env.SSLCOMMERZ.API_BASE` stays pinned
 * to the real hosts, because the validation response is what marks an order
 * paid, and an overridable address is one misconfiguration away from trusting
 * somebody else's answer.
 */

const GATEWAY_HOSTS = ["https://sandbox.sslcommerz.com", "https://securepay.sslcommerz.com"];

export interface FakePayment {
  tran_id: string;
  amount: string;
  currency: string;
  status: string;
  card_type?: string;
  bank_tran_id?: string;
}

type SessionMode = "ok" | "refuse" | "unreachable";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const urlOf = (input: RequestInfo | URL) =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

export const installFakeSslcommerz = () => {
  const realFetch = globalThis.fetch;
  const payments = new Map<string, FakePayment>();
  const sessionsOpened: string[] = [];
  const validations: string[] = [];
  let sessionMode: SessionMode = "ok";
  let counter = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    if (!GATEWAY_HOSTS.some((host) => url.startsWith(host))) return realFetch(input, init);

    const { pathname, searchParams } = new URL(url);

    if (pathname === "/gwprocess/v4/api.php") {
      if (sessionMode === "unreachable") throw new TypeError("fetch failed");

      const tranId = new URLSearchParams(String(init?.body ?? "")).get("tran_id") ?? "";
      sessionsOpened.push(tranId);

      if (sessionMode === "refuse") return json({ status: "FAILED", failedreason: "Store is not active" });
      return json({
        status: "SUCCESS",
        sessionkey: `SK-${tranId}`,
        GatewayPageURL: `https://sandbox.sslcommerz.com/pay/${tranId}`,
      });
    }

    if (pathname === "/validator/api/validationserverAPI.php") {
      const valId = searchParams.get("val_id") ?? "";
      validations.push(valId);
      const payment = payments.get(valId);
      // What the real validator answers for a val_id it has never issued.
      return json(payment ? { ...payment, val_id: valId } : { status: "INVALID_TRANSACTION" });
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  return {
    /**
     * The customer completes the gateway page for `tranId`. Returns the val_id
     * the IPN for it will carry; `overrides` fakes what the gateway reports.
     */
    pay(tranId: string, amount: number, overrides: Partial<FakePayment> = {}) {
      counter += 1;
      const valId = `VAL-${counter}-${tranId}`;
      payments.set(valId, {
        tran_id: tranId,
        amount: amount.toFixed(2),
        currency: "BDT",
        status: "VALID",
        card_type: "VISA-Dutch Bangla",
        ...overrides,
      });
      return valId;
    },
    setSessionMode(mode: SessionMode) {
      sessionMode = mode;
    },
    sessionsOpened,
    validations,
    restore() {
      globalThis.fetch = realFetch;
    },
  };
};

export type FakeSslcommerz = ReturnType<typeof installFakeSslcommerz>;
