// Configura tu webhook aquí
const WEBHOOK_URL = "https://angelrodrigo.app.n8n.cloud/webhook/operacion";

document.addEventListener('DOMContentLoaded', () => {
  // Soporta #mathForm (tu HTML actual) y fallback a #opForm si lo usas en otra vista
  const formEl = document.getElementById('mathForm') || document.getElementById('opForm');
  const exprInput = document.getElementById('expression');
  const cardOutput = document.getElementById('resultCard');
  const valueOutput = document.getElementById('resultValue');
  const exprOutput = document.getElementById('resultExpr');
  const resetBtn = document.getElementById('clearBtn');

  if (!formEl || !exprInput || !cardOutput || !valueOutput || !exprOutput || !resetBtn) {
    console.error("Faltan elementos del DOM requeridos. Verifica IDs: #mathForm/#opForm, #expression, #resultCard, #resultValue, #resultExpr, #clearBtn");
    return;
  }

  function setLoading() {
    cardOutput.classList.remove('d-none', 'alert-primary', 'alert-success', 'alert-danger', 'alert-info');
    cardOutput.classList.add('alert', 'alert-info');
  }
  function setAlert(ok) {
    cardOutput.classList.remove('alert-info', 'alert-primary', 'alert-success', 'alert-danger', 'd-none');
    cardOutput.classList.add('alert', ok ? 'alert-success' : 'alert-danger');
  }

  function displayLoading() {
    exprOutput.textContent = 'Procesando operación...';
    valueOutput.textContent = '';
    setLoading();
  }
  function displayResult(expText, val) {
    exprOutput.textContent = expText;
    valueOutput.textContent = val;
    setAlert(true);
  }
  function displayError(msg) {
    exprOutput.textContent = msg;
    valueOutput.textContent = '';
    setAlert(false);
  }

  resetBtn.addEventListener('click', () => {
    exprInput.value = '';
    exprInput.classList.remove('is-invalid');
    cardOutput.classList.add('d-none');
  });

  // =======================
  // Obtener IPs del cliente
  // =======================
  async function getPublicIp() {
    try {
      const r = await fetch('https://api.ipify.org?format=json');
      const j = await r.json();
      return j.ip || null;
    } catch {
      return null;
    }
  }

  function getLocalIp() {
    return new Promise((resolve) => {
      try {
        const ips = new Set();
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel("");

        pc.onicecandidate = (e) => {
          if (!e.candidate) {
            resolve(Array.from(ips)[0] || null);
            pc.close();
            return;
          }
          const match = e.candidate.candidate.match(/([0-9]{1,3}(\.[0-9]{1,3}){3})/);
          if (match) ips.add(match[1]);
        };

        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .catch(() => resolve(null));

        // Fallback por timeout
        setTimeout(() => {
          try { pc.close(); } catch {}
          resolve(Array.from(ips)[0] || null);
        }, 1500);
      } catch {
        resolve(null);
      }
    });
  }

  // Normaliza lo que venga en data.resultado (número o texto del modelo)
  function normalizeServerResult(raw) {
    if (raw == null) return 'Sin resultado';

    // Si es número directo
    if (typeof raw === 'number') return String(raw);

    // Si es string, limpiamos y tratamos de extraer el primer número
    if (typeof raw === 'string') {
      let s = raw.trim();

      // Quita fences de código ``` ... ``` si el LLM respondió así
      s = s.replace(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/m, '$1').trim();

      // Cambia coma decimal por punto para reconocer 1,23 => 1.23
      const commaDecimal = s.replace(/(\d),(\d)/g, '$1.$2');

      // Busca el primer número (soporta decimales y notación científica)
      const m = commaDecimal.match(/-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?/);
      if (m) return m[0];

      // Si no hay número claro, muestra el texto tal cual
      return s;
    }

    // Si viene un objeto/array, muéstralo como JSON compacto
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }

  // =======================
  // Envío y manejo respuesta
  // =======================
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();

    const raw = exprInput.value.trim();
    if (!raw) {
      exprInput.classList.add('is-invalid');
      return;
    }
    exprInput.classList.remove('is-invalid');

    displayLoading();

    const clientDatetime = new Date().toISOString();

    try {
      const [publicIp, localIp] = await Promise.all([getPublicIp(), getLocalIp()]);

      const payload = {
        expression: raw,
        clientLocalIP: localIp,
        clientPublicIp: publicIp,
        clientDatetime
      };

      let response;
      try {
        response = await fetch(WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } catch (fetchErr) {
        displayError("❌ Error al contactar el servidor.");
        console.error("[FETCH ERROR]", fetchErr);
        return;
      }

      const textResponse = await response.text();
      let data = null;
      try {
        data = JSON.parse(textResponse);
      } catch {
        // La respuesta no fue JSON válido; se mantiene data = null
      }

      if (!response.ok) {
        const msg = (data && (data.message || data.error)) || `❌ Error ${response.status}`;
        displayError(msg);
        return;
      }

      if (data && Object.prototype.hasOwnProperty.call(data, 'resultado')) {
        const val = normalizeServerResult(data.resultado);
        displayResult(raw, val);
      } else {
        // Sin campo 'resultado': mostrar texto crudo o mensaje genérico
        const fallback = textResponse && textResponse.trim() ? textResponse.trim() : "Operación enviada (sin resultado JSON).";
        displayResult(raw, fallback);
      }
    } catch (err) {
      console.error("[GENERAL ERROR]", err);
      displayError("❌ Error al procesar la respuesta.");
    }
  });
});