import { createServer } from 'node:http'
import type { TestClient, TestDeployment } from '@ketvietlab/ketjs/testing'

/** Authenticated native evidence transport. Test-only; never a production route. */
export async function reviewFlow(app: TestDeployment, client: TestClient, route: string, port = 3696) {
  const proxy = createServer(async (req, res) => {
    try {
      const body: Buffer[] = []
      for await (const chunk of req) body.push(Buffer.from(chunk))
      const headers = new Headers()
      for (const [name, value] of Object.entries(req.headers))
        if (value && !['host', 'connection', 'content-length', 'cookie'].includes(name))
          headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      headers.set('cookie', client.jar.header())
      if (headers.has('origin')) headers.set('origin', new URL(app.baseUrl).origin)
      const response = await fetch(new URL(req.url ?? '/', app.baseUrl), {
        method: req.method,
        headers,
        redirect: 'manual',
        ...(body.length ? { body: Buffer.concat(body) } : {}),
      })
      res.statusCode = response.status
      response.headers.forEach((value, name) => {
        if (
          !['content-length', 'content-encoding', 'connection', 'transfer-encoding', 'set-cookie'].includes(
            name,
          )
        )
          res.setHeader(name, value)
      })
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch {
      res.writeHead(502)
      res.end('Native evidence transport failed')
    }
  })
  await new Promise<void>((resolve) => proxy.listen(port, '127.0.0.1', resolve))
  console.log(
    JSON.stringify({
      evidence: `http://127.0.0.1:${port}${route}`,
      mode: 'synthetic-native-evidence',
    }),
  )
  await new Promise<void>((resolve) => {
    process.once('SIGTERM', () => resolve())
    process.once('SIGINT', () => resolve())
  })
  await new Promise<void>((resolve) => proxy.close(() => resolve()))
}
