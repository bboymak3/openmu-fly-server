# ============================================================
# Dockerfile - OpenMU Server (Mu Online Season 6 Episode 3)
# Multi-stage build: compila desde el codigo fuente oficial
# ============================================================

# ---- BUILD STAGE ----
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 https://github.com/MUnique/OpenMU.git /src

WORKDIR /src

RUN dotnet publish ./src/Startup/OpenMU.Startup.csproj -c Release -o /app/publish

# ---- RUNTIME STAGE ----
FROM mcr.microsoft.com/dotnet/aspnet:8.0

RUN apt-get update && apt-get install -y --no-install-recommends \
    libicu-dev \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/publish /app

WORKDIR /app

ENV ASPNETCORE_URLS=http://+:1234
ENV DOTNET_RUNNING_IN_CONTAINER=true
ENV TZ=America/Santiago

EXPOSE 1234 44405 55901

ENTRYPOINT ["dotnet", "OpenMU.Startup.dll"]
