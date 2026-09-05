FROM alpine:3.22.1@sha256:eafc1edb577d2e9b458664a15f23ea1c370214193226069eb22921169fc7e43f
COPY xExtension-FeedBuilder /bundle
ARG SOURCE_REVISION
RUN test -n "$SOURCE_REVISION" && printf '%s\n' "$SOURCE_REVISION" > /bundle/.source-commit
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
CMD ["sh", "-ec", "cp -a /bundle/. /extension/"]
