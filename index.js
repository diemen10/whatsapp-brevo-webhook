import axios from "axios";

/** Lee el raw body del request (Twilio envía x-www-form-urlencoded) */
async function readRawBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/** Convierte x-www-form-urlencoded → objeto JS */
function parseFormUrlEncoded(str) {
  const params = new URLSearchParams(str);
  const obj = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return obj;
}

export default async function handler(req, res) {
  // Solo aceptar POST (Twilio enviará POST)
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  // 1) Leer y parsear el cuerpo del mensaje entrante
  const raw = await readRawBody(req);
  const body = parseFormUrlEncoded(raw);

  // 2) Extraer info relevante (From y Body)
  const fromRaw = body.From || "";
  const from = fromRaw.replace("whatsapp:", ""); // Debe quedar +34..., +63..., etc. (E.164)
  const text = (body.Body || "").trim();

  // Logs de diagnóstico
  console.log("📩 Twilio payload keys:", Object.keys(body || {}));
  console.log("📩 From raw:", fromRaw, "Parsed number:", from);
  console.log("📩 Message text length:", text.length);
  console.log("🔐 BREVO_API_KEY present?", Boolean(process.env.BREVO_API_KEY));

  if (!from || !from.startsWith("+")) {
    console.error("❗ Número inválido (debe ser E.164 con +). Form completo:", body);
  }

  // 3) Payload para Brevo — probamos primero con WHATSAPP (identificador en MAYÚSCULAS)
  let payload = {
    WHATSAPP: from,
    attributes: {
      SOURCE: "WhatsApp",
      FIRST_MSG: text,
      WHATSAPP_OPTIN: true,
    },
    updateEnabled: true,
  };

  const listId = process.env.BREVO_LIST_ID;
  if (listId) payload.listIds = [Number(listId)];

  const headers = {
    "api-key": process.env.BREVO_API_KEY || "",
    "Content-Type": "application/json",
  };

  // 4) Llamada a Brevo con reintento automático usando SMS si falla WHATSAPP
  try {
    // Intento 1: usar WHATSAPP como identificador
    let r = await axios.post("https://api.brevo.com/v3/contacts", payload, {
      headers,
      timeout: 10000,
      validateStatus: () => true, // no lances excepción automática
    });
    console.log("📤 Brevo try WHATSAPP → status:", r.status);

    if (r.status >= 300) {
      console.error("❌ Brevo (WHATSAPP) body:", r.data);

      // Intento 2: reintentar con SMS (MAYÚSCULAS)
      payload = { ...payload };
      delete payload.WHATSAPP;
      payload.SMS = from;

      const r2 = await axios.post("https://api.brevo.com/v3/contacts", payload, {
        headers,
        timeout: 10000,
        validateStatus: () => true,
      });
      console.log("📤 Brevo try SMS → status:", r2.status);

      if (r2.status >= 300) {
        console.error("❌ Brevo (SMS) body:", r2.data);
      } else {
        console.log("✅ Brevo OK with SMS:", r2.data);
      }
    } else {
      console.log("✅ Brevo OK with WHATSAPP:", r.data);
    }
  } catch (e) {
    console.error("❌ Brevo NETWORK error:", e.message);
  }

  // 5) Responder a Twilio
  res.status(200).send("OK");
}
