import http from 'node:http'

const port = Number(process.env.QA_PROVIDER_PORT || 8796)
const expectedKey = process.env.QA_PROVIDER_KEY || 'qa-provider-key'
const server = http.createServer((request, response) => {
  if (
    request.method !== 'POST' ||
    request.url !== '/analyze' ||
    request.headers.authorization !== `Bearer ${expectedKey}`
  ) {
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ message: 'not found' }))
    return
  }
  let received = ''
  request.on('data', chunk => {
    received += chunk
  })
  request.on('end', () => {
    const body = JSON.parse(received || '{}')
    const hasFaceVideo = Boolean(body.faceVideo?.base64 && body.faceVideo?.mimeType?.startsWith('video/'))
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        status: 'COMPLETED',
        reason: 'COMPLETED',
        provider: 'مزود اختبار تشابه الوجه',
        confidence: 0.96,
        fields: {
          fullName: 'مواطن اختبار OCR',
          documentNumber: 'P-REVIEW-123456',
          dateOfBirth: '1991-04-12',
          nationality: 'عراقي',
          sex: 'ذكر',
          expiryDate: '2031-04-12',
        },
        documentTypeDetected: body.documentType || 'PASSPORT',
        faceCrop: null,
        faceComparison: hasFaceVideo
          ? { status: 'MATCH_ASSISTED', confidence: 0.87 }
          : { status: 'NOT_PROVIDED', confidence: null },
      })
    )
  })
})
server.listen(port, '127.0.0.1', () => console.log(`qa_mock_identity_analysis_provider=${port}`))
