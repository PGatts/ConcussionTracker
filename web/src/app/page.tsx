import Link from "next/link";
import Image from "next/image";

export default function Home() {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="text-center space-y-8">
        <div className="flex items-center justify-center mb-4">
          <Link href="/">
            <Image src="/logo.png" alt="Happy Head" width={1200} height={300} className="h-40 sm:h-56 md:h-72 object-contain w-auto cursor-pointer hover:opacity-80 transition-opacity" priority />
          </Link>
        </div>
        
        <div className="grid md:grid-cols-2 gap-8 mt-12">
          {/* Camera Page Card */}
          <Link href="/camera" className="group">
            <div className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow p-8 border border-gray-200 group-hover:border-blue-300">
              <div className="text-center space-y-4">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto group-hover:bg-blue-200 transition-colors">
                  <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-semibold text-gray-900">Live Camera</h2>
                <p className="text-gray-600">
                  Real-time collision detection using your webcam. Automatically records and downloads collision events.
                </p>
                <div className="text-sm text-blue-600 font-medium group-hover:text-blue-700">
                  Start Monitoring →
                </div>
              </div>
            </div>
          </Link>

          {/* Events Page Card */}
          <Link href="/events" className="group">
            <div className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow p-8 border border-gray-200 group-hover:border-green-300">
              <div className="text-center space-y-4">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto group-hover:bg-green-200 transition-colors">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-semibold text-gray-900">Event Data</h2>
                <p className="text-gray-600">
                  View historical collision data, analytics, and trends. Manage and analyze recorded events.
                </p>
                <div className="text-sm text-green-600 font-medium group-hover:text-green-700">
                  View Analytics →
                </div>
              </div>
            </div>
          </Link>
        </div>

        <div className="mt-12 p-6 bg-gray-50 rounded-lg">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">About Happy Head</h3>
          <p className="text-gray-600 text-sm mb-3">
            Happy Head is a modular IoT platform dedicated to the safety of the next generation of athletes. 
            We believe that every play, every practice, and every season should be guided by clarity—not guesswork. 
            By unifying sensor data, intuitive software, and responsible design, we transform raw impact signals 
            into insight and action.
          </p>
          <p className="text-gray-600 text-sm">
            Our mission is simple and profound: empower families, coaches, clinicians, and athletes themselves 
            with timely, trustworthy information so that potential concussions are recognized early, recovery 
            is respected, and futures remain bright.
            <a href="/about" className="ml-2 text-blue-700 hover:underline">Learn more about our mission and platform ↗</a>
          </p>
        </div>
      </div>
    </div>
  );
}
