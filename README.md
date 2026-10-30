# OpenMU Fly Server

Servidor de Mu Online Season 6 Episode 3 usando OpenMU desplegado en Fly.io.

## Puertos

| Puerto | Servicio | Protocolo |
|--------|----------|-----------|
| 80/443 | Web Admin Panel | HTTP/HTTPS |
| 44405 | ConnectServer | TCP crudo |
| 55901 | GameServer | TCP crudo |

## Guia de despliegue

### 1. Instalar flyctl
```bash
curl -L https://fly.io/install.sh | sh
flyctl auth login
```

### 2. Crear la app
```bash
flyctl apps create openmu-mu-online
```

### 3. Crear PostgreSQL
```bash
flyctl postgres create --name openmu-db --region scl
flyctl postgres attach --postgres-app openmu-db --app openmu-mu-online
```

### 4. Generar FLY_API_TOKEN para GitHub
```bash
flyctl tokens create deploy -a openmu-mu-online
```
Copiar el token y agregarlo en:
https://github.com/bboymak3/openmu-fly-server/settings/secrets/actions
- Name: `FLY_API_TOKEN`
- Value: el token generado

### 5. Crear volumen y asignar IP
```bash
flyctl volumes create openmu_data --region scl --size 1
flyctl ips allocate-v4 --app openmu-mu-online
```
Anotar la IP asignada para el cliente de Mu.

### 6. Desplegar
Push al repo (deploy automatico via GitHub Actions) o manual:
```bash
flyctl deploy --remote-only
```

### 7. Configurar cliente de Mu Online
Editar `main.exe` con editor hex:
- IP: la asignada por Fly.io
- ConnectServer Port: 44405
- GameServer Port: 55901

Para Winlator (Android): copiar el cliente modificado al Winlator.

## Comandos utiles
```bash
flyctl status -a openmu-mu-online
flyctl logs -a openmu-mu-online
flyctl ssh console -a openmu-mu-online
flyctl ips list -a openmu-mu-online
flyctl apps restart openmu-mu-online
```

## Costos estimados: ~$4-7/mes
