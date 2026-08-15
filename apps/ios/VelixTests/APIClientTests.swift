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

    func testBuildsAuthorizedRequest() {
        let client = APIClient(baseURL: URL(string: "https://painel.exemplo.com")!, token: "tok123")
        let request = client.makeRequest(path: "/servers", method: "GET")
        XCTAssertEqual(request.url?.absoluteString, "https://painel.exemplo.com/servers")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok123")
    }
}
