# ✈️ Aerodrome Slipstream LP Bot (Base L2)
### Motor Automatizado de Liquidez Concentrada Zero-Swap con Dashboard Local

Este bot replica la estrategia de liquidez concentrada automatizada para el par **WETH/USDC (CL100)** en **Aerodrome Slipstream** (Base), permitiéndote capturar comisiones y emisiones de `$AERO` **ahorrándote el 15% de comisión** de plataformas de terceros.

---

## 🌟 Características Principales

* **Estrategia Zero-Swap:** Al salir del rango, jamás realiza swaps de mercado con pérdidas ni deslizamiento (*slippage*). Reubica el 100% de USDC o ETH en un rango contiguo inmediatamente pegado al precio.
* **Filtro Anti-Latigazos (Delay 1h):** Si el precio sale de rango por una mecha momentánea, espera 1 hora. Si el precio regresa, la posición sigue intacta sin gastar gas.
* **Dashboard Visual Integrado:** Interfaz web moderna en modo oscuro accesible desde cualquier navegador en tu red local (`http://<IP-HP-MINI>:3000`).
* **Protección Dry-Run:** Por defecto viene configurado en modo simulación para monitorizar y auditar en tiempo real antes de mover dinero real.
* **Persistencia a Prueba de Reinicios:** El estado del temporizador y el historial se guardan en disco local (`data/bot-state.json`).

---

## 🚀 Instalación en tu HP Mini con Ubuntu

### 1. Instalar Node.js 20+ en Ubuntu
Abre la terminal en Ubuntu y ejecuta:
```bash
sudo apt update && sudo apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v # Debería mostrar v22.x
```

### 2. Copiar o Clonar el Proyecto
Copia la carpeta `aerodrome-bot` a tu HP Mini (por ejemplo a `/home/tu-usuario/aerodrome-bot`).

### 3. Instalar Dependencias y Compilar
```bash
cd ~/aerodrome-bot
npm install
npm run build
```

### 4. Configurar el archivo `.env`
Copia la plantilla y edita tus variables:
```bash
cp .env.example .env
nano .env
```
* `BASE_RPC_URL`: Puedes dejar `https://mainnet.base.org` o usar tu URL gratuita de Alchemy.
* `PRIVATE_KEY`: Clave privada de la **wallet satélite** del bot.
* `DRY_RUN`: Déjalo en `true` para probar sin riesgo. Cuando quieras activar transacciones reales, pon `false`.

### 5. Probar el Bot
```bash
npm start
```
Verás la salida en consola y el enlace al Dashboard:
```
📊 Dashboard UI live at:
   👉 Local:   http://localhost:3000
   👉 Red LAN: http://192.168.1.X:3000
```
¡Abre esa dirección en el navegador de tu portátil o móvil conectado a la misma Wi-Fi para ver el panel de control!

---

## 🛡️ Configurar como Servicio 24/7 en Ubuntu (`systemd`)

Para que el bot arranque solo al encender el HP Mini y se reinicie automáticamente si falla o se va la luz:

1. Crea el archivo de servicio:
```bash
sudo nano /etc/systemd/system/aerodrome-bot.service
```

2. Pega el siguiente contenido (cambia `tu-usuario` por tu usuario de Ubuntu):
```ini
[Unit]
Description=Aerodrome Slipstream LP Keeper Bot
After=network.target

[Service]
Type=simple
User=tu-usuario
WorkingDirectory=/home/tu-usuario/aerodrome-bot
ExecStart=/usr/bin/node /home/tu-usuario/aerodrome-bot/dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

3. Activa y arranca el servicio:
```bash
sudo systemctl daemon-reload
sudo systemctl enable aerodrome-bot
sudo systemctl start aerodrome-bot
```

4. Comprobar que está corriendo:
```bash
sudo systemctl status aerodrome-bot
```

---

## 📱 Acceso al Dashboard desde tu Móvil o Portátil
Encuentra la IP local de tu HP Mini ejecutando en su terminal:
```bash
hostname -I
```
Si tu IP es por ejemplo `192.168.1.55`, simplemente abre en Chrome o Safari desde tu móvil:
`http://192.168.1.55:3000`
