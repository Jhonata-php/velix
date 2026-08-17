import XCTest
@testable import Velix

final class APIClientTests: XCTestCase {
    func testDecodesLoginSuccess() throws {
        let json = #"{"accessToken":"abc123","user":{"name":"Ana","email":"ana@x.com","role":"admin"}}"#.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(LoginResponse.self, from: json)
        XCTAssertEqual(decoded.accessToken, "abc123")
        XCTAssertEqual(decoded.user?.email, "ana@x.com")
        XCTAssertNil(decoded.reason)
    }

    func testDecodesTotpRequired() throws {
        let json = #"{"reason":"totp_required"}"#.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(LoginResponse.self, from: json)
        XCTAssertNil(decoded.accessToken)
        XCTAssertEqual(decoded.reason, "totp_required")
    }

    func testDecodesServerSummaryWithMissingMetrics() throws {
        let json = #"{"id":"s1","name":"srv1","status":"ONLINE","dockerInstalled":true}"#.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(ServerSummary.self, from: json)
        XCTAssertEqual(decoded.id, "s1")
        XCTAssertNil(decoded.metrics)
    }

    // Formato real de `Server.metrics` (parseMetrics, apps/api/src/servers/metrics.util.ts):
    // diskPercent vem como string ("42%") e loadAvg é uma lista, não um Double solto.
    func testDecodesServerSummaryWithRawMetricsShape() throws {
        let json = #"""
        {"id":"s1","name":"srv1","status":"ONLINE","dockerInstalled":true,
         "metrics":{"uptimeText":"3 days","loadAvg":[0.1,0.2,0.3],"memTotalMb":1024,
         "memUsedMb":512,"diskTotal":"20G","diskUsed":"8G","diskPercent":"42%",
         "cpuPercent":12.5,"temperatureCelsius":45.0}}
        """#.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(ServerSummary.self, from: json)
        XCTAssertEqual(decoded.metrics?.diskPercent, "42%")
        XCTAssertEqual(decoded.metrics?.loadAvg, [0.1, 0.2, 0.3])
    }

    func testBuildsAuthorizedRequest() {
        let client = APIClient(baseURL: URL(string: "https://painel.exemplo.com")!, token: "tok123")
        let request = client.makeRequest(path: "/servers", method: "GET")
        XCTAssertEqual(request.url?.absoluteString, "https://painel.exemplo.com/api/servers")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok123")
    }

    func testBuildsRequestPreservingQueryString() {
        let client = APIClient(baseURL: URL(string: "https://painel.exemplo.com")!)
        let request = client.makeRequest(path: "/servers/1/metrics/history?hours=24", method: "GET")
        XCTAssertEqual(request.url?.absoluteString, "https://painel.exemplo.com/api/servers/1/metrics/history?hours=24")
    }
}
