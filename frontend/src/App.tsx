// The complete route table. Every screen of SeatPlan Events is listed here once,
// so feature owners fill in their page file and never need to touch this one.
// Events only: the restaurant pages stay in the tree but have no route here.
import { Navigate, Route, Routes } from "react-router-dom";
import EditorPage from "./pages/editor/EditorPage";
import AttendeePage from "./pages/events/AttendeePage";
import OrganiserPage from "./pages/events/OrganiserPage";
import OrganiserDashboard from "./pages/OrganiserDashboard";
import OrganiserRegister from "./pages/OrganiserRegister";
import AccountPage from "./pages/account/AccountPage";
import ForgotPage from "./pages/account/ForgotPage";
import GuestSignInPage from "./pages/account/GuestSignInPage";
import MyEventsPage from "./pages/account/MyEventsPage";
import ParticipantRegisterPage from "./pages/account/ParticipantRegisterPage";
import MySeatPage from "./pages/account/MySeatPage";
import ResetPage from "./pages/account/ResetPage";
import EventsPage from "./pages/events-public/EventsPage";
import EventStaffPage from "./pages/events-public/EventStaffPage";
import YourAccountPage from "./pages/your-account/YourAccountPage";
import TeamPage from "./pages/owner/TeamPage";
import VenuePage from "./pages/events-public/VenuePage";
import VenuesPage from "./pages/events-public/VenuesPage";
import DirectoryPage from "./pages/directory/DirectoryPage";
import Home from "./pages/Home";
import DemoHome from "./pages/DemoHome";
import ParticipantStartPage from "./pages/ParticipantStartPage";
import JoinPage from "./pages/join/JoinPage";
import JoinSignInPage from "./pages/join/JoinSignInPage";
import RegisterPage from "./pages/join/RegisterPage";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/participant" element={<ParticipantStartPage />} />
      <Route path="/login" element={<Login />} />
      <Route path="/organiser/register" element={<OrganiserRegister />} />
      <Route path="/demo" element={<DemoHome />} />
      {/* One account: sign in or create, then Booking | Staff */}
      <Route path="/account" element={<YourAccountPage />} />
      {/* A venue's team: the owner adds the people who run its events */}
      <Route path="/owner/:venueId/team" element={<TeamPage />} />
      {/* Events, public: Event booking, Event staff, the halls and quintas, a venue's page */}
      <Route path="/events" element={<EventsPage />} />
      <Route path="/events/staff" element={<EventStaffPage />} />
      <Route path="/staff" element={<Navigate to="/events/staff" replace />} />
      <Route path="/venues" element={<VenuesPage />} />
      <Route path="/directory" element={<DirectoryPage />} />
      <Route path="/venues/:slug" element={<VenuePage />} />
      {/* Events: personal attendee link, organiser workspace */}
      <Route path="/e/:token" element={<AttendeePage />} />
      <Route path="/organiser" element={<OrganiserDashboard />} />
      <Route path="/organiser/:eventId" element={<OrganiserPage />} />
      {/* Events: the shared link (visitors) and guest accounts */}
      <Route path="/j/:token" element={<JoinPage />} />
      <Route path="/j/:token/register" element={<RegisterPage />} />
      <Route path="/j/:token/sign-in" element={<JoinSignInPage />} />
      <Route path="/my" element={<MyEventsPage />} />
      {/* The fixed /my pages come before /my/:eventId, so "account" is never read as an event id. */}
      <Route path="/my/account" element={<AccountPage />} />
      <Route path="/my/sign-in" element={<GuestSignInPage />} />
      <Route path="/my/register" element={<ParticipantRegisterPage />} />
      <Route path="/my/forgot" element={<ForgotPage />} />
      <Route path="/my/reset" element={<ResetPage />} />
      <Route path="/my/:eventId" element={<MySeatPage />} />
      {/* The floor-plan editor */}
      <Route path="/editor/:venueId" element={<EditorPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
