import styled from "styled-components";

const StyledPage = styled.div`
  background: #5397f5;
  height: 100vh;
  width: 100vw;
  position: absolute;
  top: 0;
  left: 0;
  color: white;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;

  h2 {
    font-weight: bold;
    text-transform: uppercase;
  }
  h1 {
    font-weight: bold;
  }
`;
const Container = styled.div`
  max-width: 720px;
  margin: 0 auto;
  text-align: center;
`;

const Card = styled.div`
  margin: 1rem;
  padding: 1rem;
  background: white;
  max-width: 256px;
  max-height: 256px;
  color: black;
  border-radius: 0.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;

  h2 {
    font-weight: bold;
  }
  h3 {
    font-weight: bold;
  }
`;

const PricingPlans = styled.div`
  display: flex;
  justify-content: center;
`;

const SelectButton = styled.div`
  background: rgb(58, 160, 218);
  border: 1px solid rgb(48, 139, 191);
  font-weight: bold;
  border-radius: 0.2rem;
  margin-top: 0.5rem;
  display: inline-block;
  a {
    color: white;
    padding: 0.3rem 0.5rem;
  }
`;

interface ITier {
  title: string;
  description: string;
  price: number;
  cta: string;
}

const Tier = ({ title, description, price, cta }: ITier) => {
  return (
    <Card>
      <h3 className="subtitle is-4">{title}</h3>
      <p>{description}</p>
      <p className="title is-5">
        <span className="title is-3">{price}</span> ${" "}
        {price > 10 ? "once" : "month"}
      </p>
      <div>
        <SelectButton>
          <a href={cta}>Select</a>
        </SelectButton>
      </div>
    </Card>
  );
};

const PreSignupPage = () => {
  return (
    <StyledPage>
      <Container>
        <h2 className="has-text-white subtitle is-4">new!</h2>
        <h1 className="title has-text-white is-1">
          Automatically synchronise your Notion notes in to Anki
        </h1>
        <p style={{ textAlign: "left" }}>
          Creating flashcards has never been easer than this. You can now
          collaborate with your friends using Notion and create flashcards
          insanely fast!
        </p>
        <span>TODO: image in here</span>
        <p style={{ textAlign: "left", marginBottom: "1rem" }}>
          2anki.net is open source and will remain free but in order to dedicate
          more time and effort to providing a great service. We need to invest a
          lot of time in the project. Contuing down a free path for the hosted
          version is not sustainable, hence we are offering you the option to
          show your ineterest for a PRO version with less restrictions and more
          power to you.
        </p>

        <h3 className="subtitle is-3 has-text-white">
          Get a 10% discount if you pre-signup. <br />
          No creditcard required.
        </h3>
        <p className="is-4 subtitle has-text-white">Select your plan</p>
        <PricingPlans>
          <Tier
            title="Monthly"
            description="Perfect for students on a budget"
            price={10}
            cta="#"
          />
          <Tier
            title="Life time supporter"
            description="For die-hard supporters and life-long learners"
            price={90}
            cta="#"
          />
        </PricingPlans>
      </Container>
    </StyledPage>
  );
};

export default PreSignupPage;
