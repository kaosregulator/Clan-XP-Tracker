import React from 'react';

export function TermsOfService() {
  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-4xl font-bold mb-2">Terms of Service</h1>
        <p className="text-gray-400 mb-8">Last Updated: August 10, 2026</p>

        <div className="prose prose-invert max-w-none space-y-6">
          <section>
            <h2 className="text-2xl font-bold mt-8 mb-4">1. Acceptance of Terms</h2>
            <p>By accessing and using Clan XP Tracker (the "Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to all of these Terms, please do not use the Service. We reserve the right to modify these Terms at any time without prior notice. Your continued use of the Service following the posting of revised Terms means that you accept and agree to the changes.</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mt-8 mb-4">2. Description of Service</h2>
            <p>Clan XP Tracker is a Discord bot and web application ("Service") designed to track daily activity and XP for gaming clans and communities. The Service allows:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Members to submit daily activity via screenshots</li>
              <li>Staff to review and approve submissions</li>
              <li>Automatic tracking of XP, streaks, and member rankings</li>
              <li>Dashboard analytics and reporting</li>
              <li>Clan configuration and customization</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold mt-8 mb-4">3. User Eligibility</h2>
            <p>You must be at least 13 years old to use the Service. By using the Service, you represent and warrant that you:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Are at least 13 years old</li>
              <li>Have the legal capacity to enter into a binding agreement</li>
              <li>Are not prohibited by law from using the Service</li>
              <li>Agree to comply with all applicable laws and regulations</li>
              <li>Will not violate these Terms or any third-party rights</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold mt-8 mb-4">4. User Accounts</h2>
            <h3 className="text-xl font-semibold mt-4 mb-2">4.1 Account Creation</h3>
            <p>You may create an account by authorizing the Service via Discord OAuth2. You are responsible for:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Providing accurate, current, and complete information</li>
              <li>Maintaining the confidentiality of your account credentials</li>
              <li>All activity that occurs under your account</li>
              <li>Promptly notifying us of any unauthorized access</li>
            </ul>

            <h3 className="text-xl font-semibold mt-4 mb-2">4.2 Account Termination</h3>
            <p>We may terminate or suspend your account at any time, with or without cause, and without prior notice. Upon termination, your right to use the Service immediately ceases.</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mt-8 mb-4">5. User Conduct</h2>
            <p>You agree not to:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Violate any applicable laws or regulations</li>
              <li>Infringe on intellectual property rights</li>
              <li>Upload malware, viruses, or malicious code</li>
              <li>Harass, threaten, or defame other users</li>
              <li>Spam or send unsolicited communications</li>
              <li>Attempt to gain unauthorized access to the Service or other accounts</li>
              <li>Engage in any form of fraud or deception</li>
              <li>Reverse engineer, disassemble, or attempt to derive source code</li>
              <li>Use automated tools (bots, scrapers) without authorization</li>
              <li>Interfere with the proper functioning of the Service</li>
              <li>Bypass security measures or restrictions</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold mt-8 mb-4">6. Intellectual Property Rights</h2>
            <h3 className="text-xl font-semibold mt-4 mb-2">6.1 Service Content</h3>
            <p>The Service, including all code, designs, graphics, and text, is the exclusive property of the creator(s) unless otherwise noted. These materials are protected by copyright and other intellectual property laws.</p>

            <h3 className="text-xl font-semibold mt-4 mb-2">6.2 User Content</h3>
            <p>You retain all rights to any content you upload (screenshots, text, etc.). By uploading content, you grant the Service a non-exclusive, royalty-free, perpetual license to use, display, and analyze your submissions for the purposes of the Service.</p>

            <h3 className="text-xl font-semibold mt-4 mb-2">6.3 Open Source</h3>
            <p>Portions of the Service are open source and governed by their respective licenses (MIT, etc.). See the repository for details.</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mt-8 mb-4">7. Disclaimer of Warranties</h2>
            <p className="text-yellow-300 font-semibold">THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT ANY EXPRESS OR IMPLIED WARRANTY OF ANY KIND, INCLUDING BUT NOT LIMITED TO:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>WARRANTIES OF MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE</li>
              <li>WARRANTIES OF TITLE OR NON-INFRINGEMENT</li>
              <li>WARRANTIES THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE</li>
              <li>WARRANTIES REGARDING THE ACCURACY OR RELIABILITY OF CONTENT</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold mt-8 mb-4">8. Limitation of Liability</h2>
            <p className="text-yellow-300 font-semibold">TO THE FULLEST EXTENT PERMITTED BY LAW, IN NO EVENT SHALL THE SERVICE, ITS CREATORS, OR CONTRIBUTORS BE LIABLE FOR:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Direct, indirect, incidental, special, or consequential damages</li>
              <li>Loss of profits, revenue, data, or goodwill</li>
              <li>Business interruption or loss of use</li>
              <li>Any damages arising from or related to your use of the Service</li>
              <li>Claims arising from user-submitted content</li>
            </ul>
            <p className="mt-4">This limitation applies even if we have been advised of the possibility of such damages.</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mt-8 mb-4">9. Data and Privacy</h2>
            <p>Your use of the Service is governed by our <a href="/privacy" className="text-blue-400 hover:underline">Privacy Policy</a>. We collect and process personal data as described in that policy. By using the Service, you consent to our data practices.</p>

            <h3 className="text-xl font-semibold mt-4 mb-2">9.1 Data Storage</h3>
            <p>The Service stores:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Discord user IDs and usernames</li>
              <li>XP submissions and screenshots</li>
              <li>Member profiles and statistics</li>
              <li>Audit logs and activity records</li>
            </ul>

            <h3 className="text-xl font-semibold mt-4 mb-2">9.2 Data Security</h3>
            <p>We implement reasonable security measures but cannot guarantee absolute security. You use the Service at your own risk.</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mt-8 mb-4">10. Third-Party Services</h2>
            <p>The Service integrates with Discord and other third-party services. We are not responsible for:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Outages or failures of third-party services</li>
              <li>Changes to third-party APIs or terms</li>
              <li>Data loss from third-party services</li>
              <li>Violations of third-party terms of service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold mt-8 mb-4">11. Indemnification</h2>
            <p>You agree to indemnify, defend, and hold harmless the Service, its creators, and contributors from any claims, damages, losses, or expenses (including legal fees) arising from:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Your violation of these Terms</li>
              <li>Your use of the Service</li>
              <li>Your violation of any third-party rights</li>
              <li>Content you upload or submit</li>
              <li>Your conduct on the Service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold mt-8 mb-4">12. Dispute Resolution</h2>
            <h3 className="text-xl font-semibold mt-4 mb-2">12.1 Governing Law</h3>
            <p>These Terms are governed by and construed in accordance with the laws of the jurisdiction in which the Service creator resides, without regard to conflict of law principles.</p>

            <h3 className="text-xl font-semibold mt-4 mb-2">12.2 Arbitration</h3>
            <p>Any dispute arising from these Terms or the Service shall be resolved through binding arbitration rather than litigation, except that either party may seek injunctive relief in court.</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mt-8 mb-4">13. Modifications to Service</h2>
            <p>We reserve the right to:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Modify, suspend, or discontinue the Service at any time</li>
              <li>Change features, functionality, or availability</li>
              <li>Impose new or revised restrictions on user conduct</li>
              <li>Remove user accounts or content without notice</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold mt-8 mb-4">14. Severability</h2>
            <p>If any provision of these Terms is found to be invalid or unenforceable, the remaining provisions shall remain in full force and effect.</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mt-8 mb-4">15. Entire Agreement</h2>
            <p>These Terms, together with our Privacy Policy, constitute the entire agreement between you and the Service regarding your use of the Service and supersede all prior agreements and understandings.</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mt-8 mb-4">16. Contact</h2>
            <p>For questions about these Terms, please contact the Service creator through:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>GitHub Issues: <a href="https://github.com/kaosregulator/Clan-XP-Tracker" className="text-blue-400 hover:underline">https://github.com/kaosregulator/Clan-XP-Tracker</a></li>
              <li>Discord: [Community Server]</li>
            </ul>
          </section>

          <section className="bg-gray-800 p-4 rounded-lg mt-8">
            <p className="text-center text-sm">By using Clan XP Tracker, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
