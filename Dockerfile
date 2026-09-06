FROM alpine:3.22 AS builder
WORKDIR /app
ARG BUILD_DIR=build/m-ai-closure
COPY ${BUILD_DIR}-index /tmp/m-ai-closure-index
COPY ${BUILD_DIR} /nix/store
RUN mkdir /app/result \
  && cp -R "$(cat /tmp/m-ai-closure-index)"/. /app/result/

FROM scratch
COPY --from=builder /app/result /app/result
COPY --from=builder /nix/store /nix/store
COPY --from=builder /app/result/etc/ssl/certs/ca-bundle.crt /etc/ssl/certs/ca-certificates.crt
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
WORKDIR /app/result
ENTRYPOINT ["/app/result/bin/m-ai"]
