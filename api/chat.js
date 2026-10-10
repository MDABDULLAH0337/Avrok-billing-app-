// Sawal dekh kar tay karo: kitni thinking chahiye, jawab chhota ya lamba,
// aur kaun sa model. Koi extra AI call nahi — sirf tez keyword check, taaki
// koi extra der na lage.
function planFor(rawMessage, hasImage) {
  // Bill context ke saath aaya ho toh sirf asli sawal nikalo
  let q = String(rawMessage || "");
  const marker = "User ka sawal:";
  const idx = q.lastIndexOf(marker);
  if (idx !== -1) q = q.slice(idx + marker.length);
  q = q.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean).length;

  const isChat =
    words <= 5 &&
    /^(hi+|hii+|hia|his|hello|hlo|hey|namaste|namaskar|thanks?|thank you|shukriya|dhanyavad|dhanyawad|ok|okay|theek hai|thik hai|accha|acha|bye)\b/.test(q) ||
    /\b(kaise ho|kese ho|kaisa hai|kya haal|how are you|kaun ho|kon ho|who are you)\b/.test(q);
  const wantsShort =
    /\b(short|chhota|chota|chhoti|choti|sankshep|briefly|brief|ek line|1 line|one line)\b|संक्षेप|छोटा/.test(q);
  const wantsLong =
    /\b(detail|details|detailed|vistar|vistaar|poori jankari|puri jankari|explain|samjha|samjhao|step by step|deep)\b|विस्तार|समझा/.test(q);
  const complexTrigger =
    /\b(kyu|kyun|kyon|why|kaise|kese|kaisey|how|problem|fault|kharab|nahi chal|nhi chal|band ho|error|trip|leak|repair|fix|troubleshoot|wiring|connection|connect|diagram|calculate|calculation|hisab|compare|difference|farq|not working|not cooling|cooling nahi|thanda nahi|garam|awaz|noise|shock|current aa|spark|jal|burn|wire|cable|ampere|amp|amps|load|earthing|kaun si|konsi|kaunsi|tapak|tapakna|tapak raha|chalu nahi|chalu nhi|start nahi|start nhi|on nahi|on nhi|ho raha nahi|nahi ho raha|nhi ho raha|nahi kar raha|nhi kar raha|kaam nahi|kaam nhi|band hai)\b|क्यों|कैसे|समस्या|खराब|वायरिंग/.test(q);

  if (isChat) {
    return {
      mode: "chat", level: "MINIMAL", maxTokens: 400, strong: false,
      hint: "RESPONSE STYLE: This is casual small talk. Reply in 1-2 short friendly lines only."
    };
  }
  if (wantsShort && !hasImage) {
    return {
      mode: "short", level: "MINIMAL", maxTokens: 600, strong: false,
      hint: "RESPONSE STYLE: The user wants a brief answer. Reply in at most 3 short lines, no long introduction."
    };
  }
  if (hasImage || wantsLong || complexTrigger || words > 40) {
    return {
      mode: "complex", level: "LOW", maxTokens: wantsLong ? 4096 : 3072, strong: true,
      hint: "RESPONSE STYLE: This needs a careful, detailed answer. Give a step-by-step explanation: likely causes ordered from most to least likely, what to check or measure, and how to fix it. Prioritize safety for electrical work."
    };
  }
  return {
    mode: "normal", level: "MINIMAL", maxTokens: 1024, strong: false,
    hint: "RESPONSE STYLE: Give a clear, practical answer in about 5-8 short lines. Use short bullet points only if they help. No long introduction, and no safety lecture unless there is real electrical risk. If more depth could help, end with one short line offering more detail."
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY Vercel mein configured nahi hai."
      });
    }
    const {
      message,
      messages = [],
      model = "gemini-3.5-flash",
      image
    } = req.body || {};
    if (!message && !image) {
      return res.status(400).json({
        error: "Message ya photo required hai."
      });
    }
    const systemInstruction = `
You are AVROK AI Assistant inside the AVROK ACS application.
You have advanced professional knowledge of:
AC SERVICES:
- Split AC
- Window AC
- Inverter AC
- Non-inverter AC
- Compressor
- Condenser
- Evaporator
- Expansion valve
- Capillary
- Refrigerant
- Gas charging
- Gas leakage
- Vacuuming
- Pressure
- Cooling problems
- PCB
- Sensors
- Fan motor
- Capacitor
- Contactor
- Thermostat
- Drain blockage
- Water leakage
- Ice formation
- High/low pressure
- AC installation
- AC servicing
- AC maintenance
- Troubleshooting
ELECTRICAL / ELECTRICIAN:
- Phase
- Neutral
- Earth
- Voltage
- Current
- Resistance
- Power
- Watt
- MCB
- RCCB
- RCBO
- ELCB
- Contactor
- Relay
- Capacitor
- Motor
- Single phase
- Three phase
- Earthing
- Short circuit
- Overload
- House wiring
- AC wiring
- Electrical fault finding
AVROK ACS APP:
- Bill Generator
- Quotation Generator
- Customer information
- Service information
- Billing
- Quotations
- App features and workflows
When the user sends a photo of an AC unit, PCB, wiring, switchboard, or any
electrical/AC component, carefully look at it and:
- Describe what you see relevant to the problem.
- Identify the likely fault or issue.
- Explain, step by step, how to fix it or how to wire it correctly.
- Always prioritize safety, especially for electrical connections.
Answer in the same language as the user.
If the user uses Hindi/Hinglish, answer in simple Hindi/Hinglish.
Give practical technical explanations. The RESPONSE STYLE instruction at the very end controls how long or short the answer should be, and overrides any general instruction about detail.
Do not invent actual customer, bill, stock,
quotation or app data that has not been provided.
For electrical work, always prioritize safety.
Never instruct the user to work on live electrical wiring.
`;
    const contents = Array.isArray(messages)
      ? messages.slice(-30).map(item => ({
          role:
            item.role === "assistant"
              ? "model"
              : "user",
          parts: [
            {
              text: String(
                item.content ||
                item.text ||
                ""
              )
            }
          ]
        }))
      : [];

    // Current turn: text (agar hai) + photo (agar attach ki gayi hai), dono
    // ek hi user turn ke parts ke andar Gemini ko bhejo (multimodal input).
    const currentParts = [];
    if (message) {
      currentParts.push({ text: message });
    }
    if (image && image.data) {
      currentParts.push({
        inlineData: {
          mimeType: image.mimeType || "image/jpeg",
          data: image.data
        }
      });
    }
    if (currentParts.length === 0) {
      currentParts.push({ text: "" });
    }
    contents.push({
      role: "user",
      parts: currentParts
    });

    // Prevent invalid model path manipulation
    const cleanModel = String(model)
      .replace(/^models\//, "")
      .trim();

    // Model order: text sawal ke liye sabse tez (Flash-Lite) pehle, photo ke liye
    // behtar vision wala model pehle. Koi model dheema/overloaded ho toh agla try.
    const FAST = "gemini-3.1-flash-lite";
    const hasImage = !!(image && image.data);
    const plan = planFor(message, hasImage);
    console.log("Plan:", plan.mode);
    // Simple sawal -> tez Flash-Lite pehle. Mushkil sawal/photo -> 3.5 Flash pehle.
    const modelsToTry = (plan.strong
      ? [cleanModel, FAST, "gemini-3.8-flash"]
      : [FAST, cleanModel, "gemini-3.8-flash"]
    ).filter((m, i, arr) => arr.indexOf(m) === i);
    // Itne ms mein pehla chunk (pehla word) na aaye toh us model ko chhod do
    const FIRST_TOKEN_TIMEOUT_MS = image && image.data ? 25000 : 12000;

    // Thinking jitni kam, jawab utna tez. Gemini app bhi isi liye tez lagta hai.
    // 3.5 Flash / 3.1 Flash-Lite: MINIMAL (sabse tez). 3.7/3.8 Flash MINIMAL
    // support nahi karte (400 error), unke liye LOW.
    const levelFor = (m) => (/3\.[78]/.test(m) ? "LOW" : plan.level);

    const buildBody = (level) =>
      JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction + "\n\n" + plan.hint }] },
        contents,
        generationConfig: {
          // Gemini 3 ki thinking tokens bhi isi budget mein katti hain
          maxOutputTokens: plan.maxTokens,
          ...(level ? { thinkingConfig: { thinkingLevel: level } } : {})
        }
      });

    // Ek model try karo: response headers + pehla chunk timeout ke andar aana chahiye
    const attempt = async (m, level) => {
      const t0 = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FIRST_TOKEN_TIMEOUT_MS);
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:streamGenerateContent?alt=sse`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey
            },
            body: buildBody(level),
            signal: ctrl.signal
          }
        );
        if (!r.ok) {
          clearTimeout(timer);
          let errData = {};
          try {
            errData = await r.json();
          } catch (e) {}
          return {
            ok: false,
            status: r.status,
            message: errData?.error?.message || "Gemini API error"
          };
        }
        const reader = r.body.getReader();
        const first = await reader.read(); // pehla chunk aane tak wait
        clearTimeout(timer);
        console.log("First chunk from " + m + " in " + (Date.now() - t0) + "ms");
        return { ok: true, reader, first };
      } catch (err) {
        clearTimeout(timer);
        return {
          ok: false,
          status: 504,
          message:
            err && err.name === "AbortError"
              ? "Model ne time par jawab shuru nahi kiya."
              : "Gemini se connect nahi ho paya."
        };
      }
    };

    let chosen = null;
    let usedModel = modelsToTry[0];
    let lastErr = { status: 500, message: "Gemini API error" };

    for (const m of modelsToTry) {
      let a = await attempt(m, levelFor(m));
      // Thinking level support na ho (400) toh LOW, phir bina thinkingConfig ke try karo
      if (!a.ok && a.status === 400 && /think/i.test(a.message || "")) {
        a = await attempt(m, "LOW");
        if (!a.ok && a.status === 400 && /think/i.test(a.message || "")) {
          a = await attempt(m, null);
        }
      }
      if (a.ok) {
        chosen = a;
        usedModel = m;
        break;
      }
      console.error("Gemini error (" + m + "):", a.status, a.message);
      lastErr = { status: a.status, message: a.message };
      // Galat API key / permission par aage try karne ka fayda nahi
      if (a.status === 401 || a.status === 403) break;
    }

    if (!chosen) {
      return res.status(lastErr.status).json({ error: lastErr.message });
    }

    // Ab plain text stream ke roop mein client ko chunk-by-chunk bhejo.
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Model-Used": usedModel,
      "X-Plan": plan.mode
    });

    const reader = chosen.reader;
    const decoder = new TextDecoder();
    let buffer = "";
    let sentAnything = false;
    let lastInfo = "";

    // Ek SSE event process karo: "data: {...}" se JSON nikal kar text bhejo.
    const handleEvent = (evt) => {
      const dataLines = evt
        .split("\n")
        .filter(l => l.startsWith("data:"))
        .map(l => l.replace(/^data:\s?/, ""));
      const payload = dataLines.join("\n").trim();
      if (!payload || payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload);
        const cand = json?.candidates?.[0];
        const textPiece =
          cand?.content?.parts
            ?.filter(p => !p.thought)
            .map(p => p.text || "")
            .join("") || "";
        if (textPiece) {
          res.write(textPiece);
          sentAnything = true;
        }
        if (cand?.finishReason && cand.finishReason !== "STOP") {
          lastInfo = "finishReason: " + cand.finishReason;
        }
        if (json?.promptFeedback?.blockReason) {
          lastInfo = "blocked: " + json.promptFeedback.blockReason;
        }
      } catch (e) {
        // incomplete/invalid JSON — ignore
      }
    };

    // Google SSE events "\r\n\r\n" se alag hote hain — pehle sab "\n" mein badlo.
    const processValue = (value) => {
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      const events = buffer.split("\n\n");
      buffer = events.pop(); // aakhri incomplete event agli baar ke liye
      for (const evt of events) handleEvent(evt);
    };

    // Pehla chunk (jo attempt() mein pehle hi padh liya tha)
    if (!chosen.first.done && chosen.first.value) {
      processValue(chosen.first.value);
    }
    let finished = chosen.first.done;
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      processValue(value);
    }
    // Stream khatam hone par bacha hua buffer bhi process karo
    buffer += decoder.decode();
    buffer = buffer.replace(/\r\n/g, "\n");
    if (buffer.trim()) handleEvent(buffer);

    if (!sentAnything) {
      res.write(
        "AI ne koi response nahi diya." + (lastInfo ? " (" + lastInfo + ")" : "")
      );
    }
    return res.end();
  } catch (error) {
    console.error("Server error:", error);
    if (!res.headersSent) {
      return res.status(500).json({
        error: "AI server error."
      });
    }
    return res.end();
  }
    }
