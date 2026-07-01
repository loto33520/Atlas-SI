ARG NODE_IMAGE=node:24.18.0-alpine3.23
ARG NGINX_IMAGE=nginx:1.30.3-alpine3.23
FROM ${NODE_IMAGE} AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
ARG VITE_MAP_WHEEL_SENSITIVITY=0.85
ARG VITE_MAP_MIN_ZOOM=0.12
ARG VITE_MAP_MAX_ZOOM=4.8
ARG VITE_MAP_DEFAULT_THEME=light
ENV VITE_MAP_WHEEL_SENSITIVITY=$VITE_MAP_WHEEL_SENSITIVITY
ENV VITE_MAP_MIN_ZOOM=$VITE_MAP_MIN_ZOOM
ENV VITE_MAP_MAX_ZOOM=$VITE_MAP_MAX_ZOOM
ENV VITE_MAP_DEFAULT_THEME=$VITE_MAP_DEFAULT_THEME
RUN npm run build

FROM ${NGINX_IMAGE}
COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY deploy/nginx/http.conf.template /etc/nginx/atlas-templates/http.conf.template
COPY deploy/nginx/https.conf.template /etc/nginx/atlas-templates/https.conf.template
COPY deploy/nginx/10-atlas-config.sh /docker-entrypoint.d/10-atlas-config.sh
COPY --from=frontend-build /build/dist /usr/share/nginx/html
EXPOSE 80 443 8080 8443
