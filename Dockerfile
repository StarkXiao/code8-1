FROM node:24-alpine

WORKDIR /app

# 先复制清单，利用层缓存
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

RUN npm install --no-audit --no-fund

# 再复制源码
COPY . .

# 生成 Prisma Client 并构建前端
RUN npx prisma generate --schema apps/server/prisma/schema.prisma \
 && npm run build

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

# 启动前先跑迁移
CMD ["sh", "-c", "npm run db:migrate && npm start"]
